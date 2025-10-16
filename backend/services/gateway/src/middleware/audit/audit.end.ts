// backend/services/gateway/src/middleware/audit/audit.end.ts
/**
 * Purpose:
 * - On response finish, append END audit blob and trigger a flush.
 * - Health requests are skipped.
 *
 * Logging:
 * - INFO  wal_flush { accepted:N } when some were persisted
 * - DEBUG wal_flush_noop when queue was empty
 * - WARN  wal_flush_failed { err } on failures (non-crashing; response already sent)
 */

import type { Request, Response, NextFunction } from "express";
import { AuditBase } from "./AuditBase";

type Target = { slug: string; version: number; route: string; method: string };

export function auditEnd() {
  return function auditEndMw(req: Request, res: Response, next: NextFunction) {
    if ((res as any).__auditEndHooked) return next();
    (res as any).__auditEndHooked = true;

    res.on("finish", async () => {
      try {
        if (isHealthPath(req)) return; // never audit health

        const wal = AuditBase.getWal(req);
        const requestId =
          AuditBase.peekRequestId(req) ?? AuditBase.getOrCreateRequestId(req);
        const httpCode = res.statusCode;
        const target = parseTarget(req);

        const endBlob = {
          meta: { service: "gateway", ts: Date.now(), requestId },
          blob: { httpCode, status: httpCode >= 400 ? "error" : "ok" },
          phase: "end",
          ...(target ? { target } : {}),
        };

        await wal.append(endBlob);

        try {
          const { accepted } = await wal.flush();
          if (accepted > 0) {
            (req as any).log?.info?.({ accepted, requestId }, "wal_flush");
          } else {
            (req as any).log?.debug?.(
              { accepted, requestId },
              "wal_flush_noop"
            );
          }
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === "string"
              ? err
              : "unknown";
          (req as any).log?.warn?.({ err: msg, requestId }, "wal_flush_failed");
          // do not rethrow; response is already finished
        }
      } catch {
        /* response already finished */
      }
    });

    next();
  };
}

function parseTarget(req: Request): Target | undefined {
  const p = req.path || "";
  const m = p.match(/^\/api\/([^/]+)\/v(\d+)(\/.*)?$/);
  if (!m) return undefined;
  const version = Number(m[2]);
  if (!Number.isFinite(version)) return undefined;
  const rest = (m[3] || "").replace(/^\/+/, "");
  return { slug: m[1], version, route: rest, method: req.method };
}

function isHealthPath(req: Request): boolean {
  const p = req.path || "";
  return /^\/api\/[^/]+\/v\d+\/health(?:\/|$)/.test(p);
}
