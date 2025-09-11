// backend/services/shared/middleware/trace5xx.ts

/**
 * Docs:
 * - Design: docs/design/backend/observability/trace5xx.md
 * - Architecture: docs/architecture/backend/OBSERVABILITY.md
 * - ADRs:
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *
 * Why:
 * - 5xx can be assigned in many places (handlers, proxy, library helpers). During triage,
 *   we need to know **where the first 5xx status was set**. This shim instruments
 *   `res.status`, `res.sendStatus`, and `res.writeHead` to capture that first site and
 *   log a compact, repo-local stack with a stable sentinel for grepping.
 *
 * Order:
 * - Mount an “early” instance before guardrails (standard), and optionally a “late”
 *   instance near proxying for deeper attribution. Observe-only: no control-flow changes.
 *
 * Notes:
 * - We log with sentinel `<<<500DBG>>>` and include `requestId`, `method`, and `url`.
 * - Stack lines are filtered to repo paths (configurable) and exclude `node_modules`
 *   and node internals to stay readable under load.
 * - `TRACE5XX_PATH_FILTER` can list comma-separated substrings that mark your code
 *   (defaults to “/backend/”). We also hard-exclude node internals and dependencies.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";

/** Pull a correlation id without re-minting; prefer req.id but fall back to common headers. */
function ridOf(req: Request) {
  const hdr =
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-amzn-trace-id"] as string | undefined);
  return (req as any).id || hdr || "";
}

/** Keep stacks readable by filtering to our repo and dropping framework noise. */
function filteredStack(): string[] {
  const raw = String(new Error("trace5xx").stack || "").split("\n");

  const allowFilters = (process.env.TRACE5XX_PATH_FILTER || "/backend/")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return raw.filter((l) => {
    const line = l.trim();
    if (!line) return false;
    // Drop node internals and dependencies
    if (line.includes("node:internal")) return false;
    if (line.includes("/internal/") || line.includes("\\internal\\"))
      return false;
    if (line.includes("/node_modules/") || line.includes("\\node_modules\\"))
      return false;
    // Include only repo-ish lines
    const inRepo = allowFilters.some((a) => line.includes(a));
    return inRepo;
  });
}

/**
 * Middleware: trace where a 5xx status is first assigned.
 * @param tag Optional tag to disambiguate placement (“early”, “late”, etc.)
 * @param serviceName For attribution in logs (use the service slug)
 */
export function trace5xx(tag = "trace5xx", serviceName = "unknown") {
  return (req: Request, res: Response, next: NextFunction) => {
    const rid = String(ridOf(req));

    // Record only the *first* setter to avoid duplicate/late noise.
    let firstSetter: { code: number; phase: string; stack: string[] } | null =
      null;

    // Patch res.status
    const _status = res.status.bind(res);
    res.status = (code: number) => {
      if (code >= 500 && !firstSetter) {
        firstSetter = { code, phase: "res.status()", stack: filteredStack() };
        logger.debug(
          {
            sentinel: "500DBG",
            tag,
            service: serviceName,
            rid,
            method: req.method,
            url: req.originalUrl || req.url,
            phase: firstSetter.phase,
            code,
            stack: firstSetter.stack,
          },
          "500 set here <<<500DBG>>>"
        );
      }
      return _status(code);
    };

    // Patch res.sendStatus if present
    const _sendStatus = res.sendStatus?.bind(res);
    if (_sendStatus) {
      res.sendStatus = (code: number) => {
        if (code >= 500 && !firstSetter) {
          firstSetter = {
            code,
            phase: "res.sendStatus()",
            stack: filteredStack(),
          };
          logger.debug(
            {
              sentinel: "500DBG",
              tag,
              service: serviceName,
              rid,
              method: req.method,
              url: req.originalUrl || req.url,
              phase: firstSetter.phase,
              code,
              stack: firstSetter.stack,
            },
            "500 set here <<<500DBG>>>"
          );
        }
        return _sendStatus(code);
      };
    }

    // Patch writeHead for lower-level status writes (e.g., proxy)
    const _writeHead = (res as any).writeHead?.bind(res);
    if (_writeHead) {
      (res as any).writeHead = (code: number, ...rest: any[]) => {
        if (code >= 500 && !firstSetter) {
          firstSetter = {
            code,
            phase: "res.writeHead()",
            stack: filteredStack(),
          };
          logger.debug(
            {
              sentinel: "500DBG",
              tag,
              service: serviceName,
              rid,
              method: req.method,
              url: req.originalUrl || req.url,
              phase: firstSetter.phase,
              code,
              stack: firstSetter.stack,
            },
            "500 set here <<<500DBG>>>"
          );
        }
        return _writeHead(code, ...rest);
      };
    }

    // Summarize on finish if the response is 5xx
    res.on("finish", () => {
      if (res.statusCode >= 500) {
        logger.debug(
          {
            sentinel: "500DBG",
            tag,
            service: serviceName,
            rid,
            method: req.method,
            url: req.originalUrl || req.url,
            phase: firstSetter?.phase || "unknown",
            code: res.statusCode,
            stack: firstSetter?.stack,
          },
          "response finished 5xx <<<500DBG>>>"
        );
      }
    });

    next();
  };
}
