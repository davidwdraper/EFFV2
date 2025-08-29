// backend/services/gateway/src/middleware/requestId.ts
import type { RequestHandler } from "express";
import { randomUUID } from "crypto";

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const hdr =
      req.headers["x-request-id"] ||
      req.headers["x-correlation-id"] ||
      req.headers["x-amzn-trace-id"];
    const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
    (req as any).id = String(id);
    res.setHeader("x-request-id", String(id));
    next();
  };
}
