// backend/services/gateway/src/middleware/audit/audit.begin.ts
/**
 * Purpose:
 * - Append a BEGIN audit blob for non-health requests. HARD-STOP if WAL does not grow.
 * - Guarantees: no inbound API proceeds without a persisted BEGIN entry.
 *
 * Behavior:
 * - Measure WAL directory usage before and after append (bytes + file count).
 * - If neither bytes nor fileCount increases, throw to error sink (fail-fast).
 *
 * Notes:
 * - Health paths are always skipped.
 * - Uses AuditBase.ensureWal(req) to obtain the IWalEngine (DI only).
 */

import type { Request, Response, NextFunction } from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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

      // ── Snapshot WAL usage (before) ────────────────────────────────────────
      const walDir = getWalDirOrThrow();
      const before = await dirUsage(walDir);

      const beginBlob = {
        meta: { service: "gateway", ts: Date.now(), requestId },
        blob: {}, // contract-required; minimal at BEGIN
        phase: "begin",
        ...(target ? { target } : {}),
      };

      await wal.append(beginBlob);

      // ── Snapshot WAL usage (after) ─────────────────────────────────────────
      const after = await dirUsage(walDir);

      // Require growth in either bytes or file count
      const grew =
        after.totalBytes > before.totalBytes ||
        after.fileCount > before.fileCount;

      if (!grew) {
        // Loud, explicit failure — Ops needs to see this before disks fill.
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

      // Breadcrumb for correlation
      (req as any).log?.edge?.(
        { requestId, walDir, bytes: after.totalBytes, files: after.fileCount },
        "audit_begin_persisted"
      );

      next();
    } catch (err) {
      next(err);
    }
  };
}

// ───────────────────────── helpers ─────────────────────────

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

function getWalDirOrThrow(): string {
  const walDir = (process.env.NV_GATEWAY_WAL_DIR ?? "").trim();
  if (!walDir) throw new Error("[gateway] NV_GATEWAY_WAL_DIR is required");
  if (!path.isAbsolute(walDir)) {
    throw new Error(
      `[gateway] NV_GATEWAY_WAL_DIR must be absolute, got "${walDir}"`
    );
  }
  return walDir;
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
