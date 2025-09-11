// backend/services/shared/middleware/entryExit.ts
import type { Request, Response, NextFunction } from "express";

export function entryExit() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    req.log.info(
      {
        msg: "handler:start",
        method: req.method,
        url: req.originalUrl,
        params: req.params,
        query: req.query,
      },
      "request entry"
    );
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      req.log.info(
        {
          msg: "handler:finish",
          statusCode: res.statusCode,
          durationMs: Math.round(ms),
        },
        "request exit"
      );
    });
    next();
  };
}
