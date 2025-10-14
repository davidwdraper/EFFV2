// backend/services/gateway/src/middleware/audit/audit.begin.ts
/**
 * Purpose:
 * - Append a BEGIN audit blob for non-health requests. No flush here.
 */

import type { Request, Response, NextFunction } from "express";
import { AuditBase } from "./AuditBase";

type Target = { slug: string; version: number; route: string; method: string };

export function auditBegin() {
  return async function auditBeginMw(
    req: Request,
    _res: Response,
    next: NextFunction
  ) {
    try {
      if (isHealthPath(req)) return next(); // never audit health

      const wal = await AuditBase.ensureWal(req);
      const requestId = AuditBase.getOrCreateRequestId(req);
      const target = parseTarget(req);

      const beginBlob = {
        meta: { service: "gateway", ts: Date.now(), requestId },
        blob: {}, // contract-required; minimal at BEGIN
        phase: "begin",
        ...(target ? { target } : {}),
      };

      await wal.append(beginBlob);
      next();
    } catch (err) {
      next(err);
    }
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
