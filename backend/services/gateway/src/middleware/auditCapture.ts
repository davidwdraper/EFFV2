// backend/services/gateway/src/middleware/auditCapture.ts
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { enqueueAudit } from "../services/auditWal";
import { auditEventContract } from "@shared/contracts/auditEvent.contract";

const HEALTH_PREFIXES = ["/health", "/ready", "/live"];
const isHealth = (p: string) =>
  HEALTH_PREFIXES.some((h) => p === h || p.startsWith(h + "/"));

declare module "express-serve-static-core" {
  interface Request {
    _nvStartHr?: [number, number];
    _nvRequestId?: string;
  }
}

export function auditCapture() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isHealth(req.path)) return next();

    req._nvStartHr = process.hrtime();
    const incomingReqId =
      (req.headers["x-request-id"] as string | undefined) ||
      (req.headers["x-correlation-id"] as string | undefined);
    const requestId = incomingReqId || randomUUID();
    req._nvRequestId = requestId;
    res.setHeader("x-request-id", requestId);

    const finalize = (finalizeReason: "normal" | "aborted" | "error") => {
      try {
        const diff = process.hrtime(req._nvStartHr);
        const durationMs = Math.round((diff[0] * 1e9 + diff[1]) / 1e6);

        const event = {
          eventId: randomUUID(),
          requestId,
          at: new Date().toISOString(),
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode || 0,
          durationMs,
          callerIp:
            (req.headers["x-forwarded-for"] as string) ||
            req.socket?.remoteAddress ||
            undefined,
          s2sCaller: (req.headers["x-s2s-caller"] as string) || "gateway",
          finalizeReason,
          // meta optional – keep PII out
        };

        // Don’t ever block request flow: validate best-effort
        try {
          auditEventContract.parse(event);
        } catch {
          /* drop silently */
        }

        enqueueAudit(event as any); // type matches contract
      } catch {
        // fire-and-forget; never throw
      }
    };

    res.on("finish", () => finalize("normal"));
    res.on("close", () => finalize("aborted"));
    res.on("error", () => finalize("error"));
    next();
  };
}
