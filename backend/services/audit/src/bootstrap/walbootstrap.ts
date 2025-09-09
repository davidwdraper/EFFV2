// backend/services/audit/src/bootstrap/walBootstrap.ts
/**
 * Why:
 * - Run WAL replay before accepting traffic so we don’t compete with live ingestion.
 * - Safe to run multiple times; upserts are idempotent on eventId.
 * Docs: design/backend/audit/OVERVIEW.md, adr/0001-audit-wal-and-batching.md
 */
import { replayAll } from "../services/walReplayer";

export async function preflightWALReplay(): Promise<void> {
  const t0 = Date.now();
  try {
    const n = await replayAll();
    // eslint-disable-next-line no-console
    console.info(
      `[audit.bootstrap] WAL replay complete; events=${n}; ms=${
        Date.now() - t0
      }`
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[audit.bootstrap] WAL replay failed: ${(err as Error).message}`
    );
    // We continue booting; operators can re-run replay later if needed.
  }
}
