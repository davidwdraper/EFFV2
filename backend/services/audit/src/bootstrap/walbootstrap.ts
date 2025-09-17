// backend/services/audit/src/bootstrap/walbootstrap.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/bootstrap/walbootstrap.ts
 * Service: audit
 *
 * Why:
 *   Preflight WAL replay before accepting live traffic (index.ts calls this).
 *   - Ensures DB is caught up from any crash/restart gaps.
 *   - INSERT-ONLY; duplicates from prior runs are ignored by unique(eventId).
 */

import { logger } from "@eff/shared/src/utils/logger";
import { replayAllWalFiles, walDirPath } from "../services/walReplayer";

export async function preflightWALReplay(): Promise<void> {
  const dir = walDirPath();
  try {
    logger.info({ walDir: dir }, "[audit.walbootstrap] starting WAL replay");
    const res = await replayAllWalFiles();
    logger.info(
      {
        files: res.files,
        attempted: res.attempted,
        inserted: res.inserted,
        duplicates: res.duplicates,
        failedLines: res.failedLines,
        walDir: dir,
      },
      "[audit.walbootstrap] WAL replay complete"
    );
  } catch (err) {
    const e = err as Error;
    logger.error({ err: e, walDir: dir }, "[audit.walbootstrap] replay failed");
    // Per SOP: fail fast so orchestrator restarts; durability must be strong.
    throw err;
  }
}
