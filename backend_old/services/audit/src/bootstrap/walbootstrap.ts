/**
 * NowVibin — Backend
 * File: backend/services/audit/src/bootstrap/walbootstrap.ts
 * Service: audit
 *
 * Why:
 *   Preflight WAL replay before accepting live traffic (index.ts calls this).
 *   - Ensures DB is caught up from any crash/restart gaps.
 *   - INSERT-ONLY; duplicates from prior runs are ignored by unique(eventId).
 *
 * NOTE:
 *   Unified with the live drainer: we now call drainAllPendingNow() so
 *   startup and API ingestion share the exact same flushing path.
 */

import { logger } from "@eff/shared/src/utils/logger";
import { drainAllPendingNow } from "../services/walDrainer";
import path from "path";

function walDirPath() {
  const dir =
    process.env.AUDIT_WAL_DIR || path.join(process.cwd(), "var", "audit-wal");
  return dir;
}

export async function preflightWALReplay(): Promise<void> {
  const dir = walDirPath();
  try {
    logger.info({ walDir: dir }, "[audit.walbootstrap] starting WAL replay");
    await drainAllPendingNow();
    logger.info({ walDir: dir }, "[audit.walbootstrap] WAL replay complete");
  } catch (err) {
    const e = err as Error;
    logger.error({ err: e, walDir: dir }, "[audit.walbootstrap] replay failed");
    // Per SOP: fail fast so orchestrator restarts; durability must be strong.
    throw err;
  }
}
