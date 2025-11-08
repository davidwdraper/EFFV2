// backend/services/gateway/src/middleware/audit/audit.end.ts
/**
 * Purpose:
 * - On response finish, append END audit entry and trigger a flush. Health is skipped.
 *
 * Docs/ADRs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0030 — ContractBase & idempotent contract identification
 */

import type { Request, Response, NextFunction } from "express";
import { AuditBase } from "./AuditBase";
import { AuditEntryBuilder } from "@nv/shared/audit/AuditEntryBuilder";

type Target = { slug: string; version: number; route: string; method: string };
const REQ_TARGET_KEY = "__auditTarget";

export function auditEnd() {
  return function auditEndMw(req: Request, res: Response, next: NextFunction) {
    if ((res as any).__auditEndHooked) return next();
    (res as any).__auditEndHooked = true;

    res.on("finish", async () => {
      const requestId =
        AuditBase.peekRequestId(req) ?? AuditBase.getOrCreateRequestId(req);

      try {
        if (isHealthPath(req)) return; // never audit health

        const wal = AuditBase.getWal(req);
        const httpCode = res.statusCode;

        // Reuse the BEGIN-computed target; fallback to originalUrl parse if missing
        const target: Target | undefined =
          (req as any)[REQ_TARGET_KEY] ?? parseTargetFromOriginal(req);

        if (!target) {
          (req as any).log?.error?.(
            { requestId, url: getOriginalPath(req) },
            "audit_end_no_target"
          );
          return;
        }

        const endEntry = AuditEntryBuilder.end({
          service: "gateway",
          requestId,
          target,
          httpCode,
        });

        await wal.append(endEntry);

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
      } catch (err) {
        (req as any).log?.error?.(
          {
            requestId,
            err: err instanceof Error ? err.message : String(err),
          },
          "audit_end_failed"
        );
        // swallow: response lifecycle is over
      }
    });

    next();
  };
}

function getOriginalPath(req: Request): string {
  return (
    ((req as any).originalUrl as string) || req.url || (req as any).path || ""
  );
}

function parseTargetFromOriginal(req: Request): Target | undefined {
  const p = getOriginalPath(req);
  const m = p.match(/^\/api\/([^/]+)\/v(\d+)(?:\/(.*))?$/);
  if (!m) return undefined;
  const version = Number(m[2]);
  if (!Number.isFinite(version)) return undefined;
  const rest = (m[3] || "").replace(/^\/+/, "");
  return { slug: m[1], version, route: rest, method: req.method };
}

function isHealthPath(req: Request): boolean {
  const p = getOriginalPath(req);
  return /^\/api\/[^/]+\/v\d+\/health(?:\/|$)/.test(p);
}
