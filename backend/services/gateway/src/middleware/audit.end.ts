// backend/services/gateway/src/middleware/audit/audit.end.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - On response finish, append END audit blob and trigger a non-blocking flush.
 * - Health remains unaudited by mounting order (health before audit.* middlewares).
 *
 * Notes:
 * - Contract requires `blob`; we place end-specific details inside `blob`.
 * - `target` follows the versioned path convention when present.
 */

// backend/services/gateway/src/middleware/audit/audit.end.ts
/**
 * Purpose:
 * - On response finish, append END + gentle flush for non-health requests.
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
          await wal.flush(); // non-blocking-ish; errors are handled/logged internally
        } catch {
          /* ignore */
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
