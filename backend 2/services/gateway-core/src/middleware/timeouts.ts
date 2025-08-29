// backend/services/gateway/src/middleware/timeouts.ts
import type { RequestHandler } from "express";

type Cfg = { gatewayMs: number };

export function timeoutsMiddleware(cfg: Cfg): RequestHandler {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          type: "about:blank",
          title: "Gateway Timeout",
          status: 504,
          detail: `Request timed out after ${cfg.gatewayMs}ms`,
          instance: (req as any).id,
        });
      }
    }, cfg.gatewayMs);

    const clear = () => clearTimeout(timer);
    res.on("finish", clear);
    res.on("close", clear);
    next();
  };
}
