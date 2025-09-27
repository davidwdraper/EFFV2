// backend/services/shared/src/middleware/problemJson.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - Design: docs/design/backend/observability/problem-json.md
 * - ADRs:
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Canonical, **shared** RFC7807 formatting with zero gateway deps.
 * - Adds `res.problem(status, body)`, prefix-aware 404, and global error formatter.
 * - Guardrail denials (auth/rate-limit/breaker/timeouts) log via SECURITY elsewhere.
 */

import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from "express";
import { logger } from "../utils/logger"; // relative import to avoid self-aliasing

// Extend Response with `res.problem`
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Response {
      problem?: (status: number, body: Record<string, any>) => void;
    }
  }
}

function ridOf(req: Request): string {
  return (
    (req as any).id ||
    (req.headers["x-request-id"] as string) ||
    (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-amzn-trace-id"] as string) ||
    ""
  );
}

/** Attaches `res.problem(status, body)`; does not alter normal JSON responses. */
export function problemJsonMiddleware(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.problem = (status: number, body: Record<string, any>) => {
      res.status(Number.isFinite(status) ? status : 500);
      res.type("application/problem+json");
      res.json(body);
    };
    next();
  };
}

/**
 * 404 tail with RFC7807 shape for **API-ish** paths only.
 * Everything else returns a bare 404 to avoid JSON-ifying static/probe noise.
 */
export function notFoundProblemJson(validPrefixes: string[]): RequestHandler {
  const prefixes = (validPrefixes || []).map((p) => (p || "").toLowerCase());
  return (req: Request, res: Response) => {
    const path = (req.path || "").toLowerCase();
    const apiish = prefixes.length
      ? prefixes.some((p) => p && path.startsWith(p))
      : true;
    if (!apiish) return res.status(404).end();
    (res.problem ?? res.status.bind(res))(404, {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Route not found",
      instance: ridOf(req),
    });
  };
}

/** Global error handler that logs trimmed context and returns RFC7807. */
export function errorProblemJson(): ErrorRequestHandler {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err?.statusCode || err?.status || 500);

    if (res.headersSent) {
      // Can’t reshape — just log for operators.
      logger.debug(
        {
          sentinel: "500DBG",
          where: "errorProblemJson(headersSent)",
          rid: ridOf(req),
          method: req.method,
          url: req.originalUrl,
          status,
          name: err?.name,
          message: err?.message,
          stack: String(err?.stack || "")
            .split("\n")
            .slice(0, 8),
        },
        "error after headers sent"
      );
      return;
    }

    if (status >= 500) {
      logger.debug(
        {
          sentinel: "500DBG",
          where: "errorProblemJson",
          rid: ridOf(req),
          method: req.method,
          url: req.originalUrl,
          status,
          name: err?.name,
          message: err?.message,
          stack: String(err?.stack || "")
            .split("\n")
            .slice(0, 8),
        },
        "500 about to be sent <<<500DBG>>>"
      );
    }

    (res.problem ?? res.status.bind(res))(
      Number.isFinite(status) ? status : 500,
      {
        type: err?.type || "about:blank",
        title:
          err?.title || (status >= 500 ? "Internal Server Error" : "Error"),
        status: Number.isFinite(status) ? status : 500,
        detail: err?.message || "Unexpected error",
        instance: ridOf(req),
      }
    );
  };
}
