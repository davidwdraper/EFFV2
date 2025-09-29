// backend/services/shared/trace.ts

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { randomUUID } from "crypto";

const traceEnabled = () => {
  if ((process.env.TRACE_ENABLED || "").toLowerCase() === "true") return true;
  return (process.env.LOG_LEVEL || "").toLowerCase() === "debug";
};

export function getRequestId(req: Request, res: Response): string {
  const rid =
    (req.headers["x-request-id"] as string) ||
    (req as any).requestId ||
    randomUUID();
  (req as any).requestId = rid;
  res.setHeader("x-request-id", rid);
  return rid;
}

export function withTrace(
  name: string,
  handler?: RequestHandler
): RequestHandler {
  if (handler) return wrap(name, handler);
  return wrap.bind(null, name) as unknown as RequestHandler;
}

function wrap(name: string, handler: RequestHandler): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const enabled = traceEnabled();
    const rid = getRequestId(req, res);
    const start = enabled ? process.hrtime.bigint() : 0n;

    if (enabled) {
      console.debug(`[TRACE enter] ${name}`, {
        method: req.method,
        path: req.originalUrl || req.url,
        requestId: rid,
      });
    }

    const finish = () => {
      if (!enabled) return;
      const durMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
      console.debug(`[TRACE exit] ${name}`, {
        status: res.statusCode,
        durationMs: durMs,
        requestId: rid,
      });
    };

    res.once("finish", finish);
    res.once("close", finish);

    try {
      await Promise.resolve(handler(req, res, next));
    } catch (e) {
      next(e);
    }
  };
}
