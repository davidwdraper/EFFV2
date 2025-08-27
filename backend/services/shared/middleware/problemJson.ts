// backend/services/shared/middleware/problemJson.ts
import type { Request, Response, NextFunction } from "express";
import { extractLogContext, postAudit } from "../utils/logger";

const IS_PROD = process.env.NODE_ENV === "production";

// 404 handler (unchanged behavior)
export function notFoundProblemJson(validPrefixes: string[]) {
  return (req: Request, res: Response) => {
    if (validPrefixes.some((p) => req.path.startsWith(p))) {
      return res
        .status(404)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Route not found",
          instance: (req as any).id,
        });
    }
    /* c8 ignore next 2 */
    return res.status(404).end();
  };
}

// Error → problem+json + fire-and-forget error event
export function errorProblemJson() {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err?.statusCode || err?.status || 500);
    const safe = Number.isFinite(status) ? status : /* c8 ignore next */ 500;

    // Build a minimal, safe error event for the Log Service; logger util enriches with caller meta
    const ctx = extractLogContext(req);
    const event = {
      channel: "error",
      level: "error",
      code: err?.code,
      message: err?.message || "Unhandled error",
      status: safe,
      path: req.originalUrl,
      method: req.method,
      ...ctx,
    };

    // Fire-and-forget to Log Service; logger util handles FS fallback / notification policy
    void postAudit(event);

    // Dev/test only: also emit to pino for local visibility (quiet in prod regardless of flags)
    if (!IS_PROD) {
      req.log?.error(
        { status: safe, path: req.originalUrl, err },
        "request error"
      );
    }

    /* c8 ignore start */
    const type = err?.type || "about:blank";
    const title =
      err?.title || (safe >= 500 ? "Internal Server Error" : "Request Error");
    const detail = err?.message || "Unexpected error";
    /* c8 ignore stop */

    res
      .status(safe)
      .type("application/problem+json")
      .json({
        type,
        title,
        status: safe,
        detail,
        instance: (req as any).id,
      });
  };
}
