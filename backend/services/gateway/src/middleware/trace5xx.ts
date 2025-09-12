// backend/services/gateway/src/middleware/trace5xx.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “Instrumentation everywhere. Debug logs on entry/exit with requestId.”
 *   • “Global error middleware. All errors flow through problem.ts + error sink.”
 * - This session’s design: guardrails → audit split; trace5xx runs *before* guards
 *   to pinpoint where a 5xx status was first set.
 *
 * Why:
 * 5xx responses can be set in many places (handlers, proxy, error paths). When you’re
 * staring at logs, you need to know **where** the first 5xx status was assigned.
 * This middleware shims a few response methods (`status`, `sendStatus`, `writeHead`)
 * to capture the *first* site that set a 5xx, logs a compact, repo-local stack
 * (no Node internals / node_modules noise), and then lets the request continue.
 *
 * Notes:
 * - Zero behavior change for normal requests; this is *observe-only*.
 * - We log with a stable sentinel `<<<500DBG>>>` so grep/alerts can key off it.
 * - We include `rid` (x-request-id), method, and URL for correlation.
 * - Health endpoints aren’t special-cased here; if they 5xx, we still want traces.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";

function ridOf(req: Request) {
  const hdr =
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-amzn-trace-id"] as string | undefined);
  return (req as any).id || hdr || "";
}

/** WHY: keep stacks readable by filtering to our repo; drop framework noise. */
function filteredStack(err: Error) {
  const raw = String(err.stack || "").split("\n");
  return raw.filter(
    (l) =>
      l.includes("/backend/services/gateway/") && !l.includes("/node_modules/")
  );
}

/**
 * Middleware: trace where a 5xx status is first set.
 * @param tag Optional tag to disambiguate placement (“early”, “late”, etc.)
 */
export function trace5xx(tag = "trace5xx") {
  return (req: Request, res: Response, next: NextFunction) => {
    const rid = String(ridOf(req));

    // WHY: record only the *first* setter to avoid duplicate/late noise.
    let firstSetter: { code: number; phase: string; stack: string[] } | null =
      null;

    // Patch res.status
    const _status = res.status.bind(res);
    res.status = (code: number) => {
      if (code >= 500 && !firstSetter) {
        firstSetter = {
          code,
          phase: "res.status()",
          stack: filteredStack(new Error("trace5xx")),
        };
        logger.debug(
          {
            sentinel: "500DBG",
            tag,
            rid,
            method: req.method,
            url: req.originalUrl,
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
            stack: filteredStack(new Error("trace5xx")),
          };
          logger.debug(
            {
              sentinel: "500DBG",
              tag,
              rid,
              method: req.method,
              url: req.originalUrl,
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
            stack: filteredStack(new Error("trace5xx")),
          };
          logger.debug(
            {
              sentinel: "500DBG",
              tag,
              rid,
              method: req.method,
              url: req.originalUrl,
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

    // After response closes, summarize any 5xx
    res.on("finish", () => {
      if (res.statusCode >= 500) {
        logger.debug(
          {
            sentinel: "500DBG",
            tag,
            rid,
            method: req.method,
            url: req.originalUrl,
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
