// backend/services/gateway/src/middleware/proxyProbe.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";

export function proxyProbe(tag: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Loud, level=info so it prints even if levels change
    logger.info(
      {
        tag,
        method: req.method,
        url: req.originalUrl,
        rid: String(req.headers["x-request-id"] || ""),
      },
      "PROXY_PROBE hit"
    );
    next();
  };
}
