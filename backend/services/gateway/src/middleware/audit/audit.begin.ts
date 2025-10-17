// backend/services/gateway/src/middleware/audit/audit.begin.ts
/**
 * Purpose:
 * - Append a BEGIN audit entry for non-health requests. HARD-STOP if WAL does not grow.
 *
 * Docs/ADRs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0030 — ContractBase & idempotent contract identification
 */

import type { Request, Response, NextFunction } from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AuditBase } from "./AuditBase";
import { AuditEntryBuilder } from "@nv/shared/audit/AuditEntryBuilder";

type Target = { slug: string; version: number; route: string; method: string };

// single place to stash the computed target for END to reuse
const REQ_TARGET_KEY = "__auditTarget";

export function auditBegin() {
  return async function auditBeginMw(
    req: Request,
    _res: Response,
    next: NextFunction
  ) {
    try {
      if (isHealthPath(req)) return next(); // never audit health

      const wal = AuditBase.getWal(req);
      const requestId = AuditBase.getOrCreateRequestId(req);
      const walDir = AuditBase.getWalDir(req);

      // Compute target from the ORIGINAL url (proxy may mutate req.path later)
      const target = parseTargetFromOriginal(req);
      if (!target) {
        (req as any).log?.error?.(
          { requestId, url: getOriginalPath(req) },
          "audit_begin_no_target"
        );
        return next(); // do not append without a valid target
      }

      // Stash target for audit.end
      (req as any)[REQ_TARGET_KEY] = target;

      // Snapshot before
      const before = await dirUsage(walDir);

      const beginEntry = AuditEntryBuilder.begin({
        service: "gateway",
        requestId,
        target,
      });

      await wal.append(beginEntry);

      // Snapshot after
      const after = await dirUsage(walDir);
      const grew =
        after.totalBytes > before.totalBytes ||
        after.fileCount > before.fileCount;

      if (!grew) {
        const detail = {
          requestId,
          walDir,
          beforeBytes: before.totalBytes,
          afterBytes: after.totalBytes,
          beforeFiles: before.fileCount,
          afterFiles: after.fileCount,
        };
        (req as any).log?.error?.(detail, "audit_begin_no_wal_growth");
        throw new Error(
          `audit_begin_hard_stop: WAL did not grow for requestId=${requestId}`
        );
      }

      (req as any).log?.edge?.(
        {
          requestId,
          walDir,
          bytesBefore: before.totalBytes,
          bytesAfter: after.totalBytes,
          filesBefore: before.fileCount,
          filesAfter: after.fileCount,
        },
        "audit_begin_persisted"
      );

      next();
    } catch (err) {
      (req as any).log?.error?.(
        {
          requestId: AuditBase.peekRequestId(req),
          err: err instanceof Error ? err.message : String(err),
        },
        "audit_begin_failed"
      );
      next(err);
    }
  };
}

// ───────────────────────── helpers ─────────────────────────

function getOriginalPath(req: Request): string {
  // prefer originalUrl, fallback to url, then path
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

async function dirUsage(
  dir: string
): Promise<{ totalBytes: number; fileCount: number }> {
  let totalBytes = 0;
  let fileCount = 0;

  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const st = await fs.stat(full);
        totalBytes += st.size;
        fileCount += 1;
      }
    }
  }

  try {
    await walk(dir);
  } catch {
    // If dir doesn't exist yet, treat as empty
  }

  return { totalBytes, fileCount };
}
