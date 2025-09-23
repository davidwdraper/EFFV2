// backend/services/gateway/src/middleware/trace5xx.ts

/**
 * trace5xx — pinpoint the first place a 5xx status is set
 * -----------------------------------------------------------------------------
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - Design: docs/design/backend/gateway/app.md
 * - ADRs:
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md   // context: consistent telemetry
 *
 * Why:
 * - 5xx can originate in handlers, proxy code, or error tails. When triaging,
 *   operators need the **first assignment site** and a tight repo-local stack.
 * - This middleware wraps a few Response APIs to record the first 5xx setter,
 *   then logs a compact trace with a stable sentinel `<<<500DBG>>>` for grep.
 *
 * Order:
 * - Mount immediately after requestId + httpLogger and **before** guardrails,
 *   so the first assignment is attributed correctly even on denials/timeouts.
 *
 * Notes:
 * - Observe-only: does not change behavior or bodies; only records metadata.
 * - Stack filtering keeps lines under the repo root and drops node internals.
 * - No env fallbacks anywhere. No config knobs. Failures never break requests.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";

// WHY: derive a repo-root prefix for readable, stable stack filtering.
const REPO_PREFIX = ((): string => {
  // Use the process working directory at runtime (service root), normalized with forward slashes
  const p = process.cwd().replace(/\\/g, "/");
  return p.endsWith("/") ? p : `${p}/`;
})();

function ridOf(req: Request): string {
  // Reuse the requestId minted by requestId middleware; fall back to common headers
  const id = (req as any).id as string | undefined;
  if (id) return id;
  const h =
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-amzn-trace-id"] as string | undefined);
  return h || "";
}

/** WHY: keep stacks readable; show only repo files, hide node internals & deps. */
function filteredStack(): string[] {
  const raw = String(new Error().stack || "").split("\n");
  return raw
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.includes(REPO_PREFIX) &&
        !l.includes("/node_modules/") &&
        !l.includes("(internal/")
    );
}

/**
 * Middleware: logs where the first 5xx status was set.
 * @param tag label to disambiguate placement ("early", "late", etc.)
 */
export function trace5xx(tag = "trace5xx") {
  return (req: Request, res: Response, next: NextFunction) => {
    const rid = ridOf(req);

    // Record only the first site that assigned a 5xx
    let firstSetter: {
      code: number;
      phase: "res.status" | "res.sendStatus" | "res.writeHead";
      stack: string[];
    } | null = null;

    // Patch res.status
    const _status = res.status.bind(res);
    res.status = (code: number) => {
      if (code >= 500 && !firstSetter) {
        firstSetter = { code, phase: "res.status", stack: filteredStack() };
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

    // Patch res.sendStatus (if present)
    const _sendStatus = (res.sendStatus as any)?.bind?.(res) as
      | ((code: number) => Response)
      | undefined;
    if (_sendStatus) {
      (res as any).sendStatus = (code: number) => {
        if (code >= 500 && !firstSetter) {
          firstSetter = {
            code,
            phase: "res.sendStatus",
            stack: filteredStack(),
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

    // Patch writeHead for low-level writers (e.g., proxy streaming)
    const _writeHead = (res as any).writeHead?.bind(res) as
      | ((code: number, ...rest: any[]) => Response)
      | undefined;
    if (_writeHead) {
      (res as any).writeHead = (code: number, ...rest: any[]) => {
        if (code >= 500 && !firstSetter) {
          firstSetter = {
            code,
            phase: "res.writeHead",
            stack: filteredStack(),
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

    // Summarize at finish to catch any 5xx that slipped through
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

export default trace5xx;
