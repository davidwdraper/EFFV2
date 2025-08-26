// backend/services/shared/middleware/problemJson.ts
import type { Request, Response, NextFunction } from "express";

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

export function errorProblemJson() {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err?.statusCode || err?.status || 500);
    req.log?.error({ msg: "handler:error", err, status }, "request error");
    const safe = Number.isFinite(status) ? status : /* c8 ignore next */ 500;
    /* c8 ignore start */
    const type = err?.type || "about:blank";
    const title = err?.title || "Internal Server Error";
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
