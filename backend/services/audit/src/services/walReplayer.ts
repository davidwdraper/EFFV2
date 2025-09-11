// backend/services/audit/src/services/walReplayer.ts
/**
 * Docs:
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Scaling: docs/architecture/backend/SCALING.md
 * - ADRs: docs/adr/0001-audit-wal-and-batching.md
 *
 * Why:
 * - On service boot, ingest any WAL-appended events not yet in Mongo.
 * - Replay NDJSON oldest→newest, bulk upsert ($setOnInsert on eventId). Safe to re-run.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import readline from "readline";
import type { AuditEvent } from "@shared/src/contracts/auditEvent.contract";
import * as repo from "../repo/auditEventRepo";

function isProd() {
  const env = String(process.env.NODE_ENV || "").toLowerCase();
  return env === "production" || env === "prod";
}
function envOrDefault(name: string, def: string): string {
  const v = process.env[name];
  if (v && v.trim() !== "") return v.trim();
  if (isProd())
    throw new Error(`[audit.walReplayer] Missing required env ${name}`);
  return def;
}

const WAL_DIR = envOrDefault(
  "AUDIT_WAL_DIR",
  path.join(process.cwd(), "var", "audit-wal")
);
const REPLAY_BATCH = Number(process.env.AUDIT_REPLAY_BATCH || "1000");
const REPLAY_MAX_FILES = Number(process.env.AUDIT_REPLAY_MAX_FILES || "1000");

export async function replayAll(): Promise<number> {
  const dirExists = await fsp
    .stat(WAL_DIR)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!dirExists) return 0;

  const files = (await fsp.readdir(WAL_DIR))
    .filter((f) => /^audit-\d{8}\.ndjson$/.test(f))
    .sort()
    .slice(0, REPLAY_MAX_FILES);

  let total = 0;
  for (const fname of files)
    total += await replayFile(path.join(WAL_DIR, fname));
  return total;
}

async function replayFile(fullPath: string): Promise<number> {
  // eslint-disable-next-line no-console
  console.info(`[audit.walReplayer] Replaying ${path.basename(fullPath)} …`);

  const stream = fs.createReadStream(fullPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let batch: AuditEvent[] = [];
  let count = 0;

  const flush = async () => {
    if (!batch.length) return;
    try {
      const { attempted, upserted } = await repo.upsertBatch(batch);
      count += attempted;
      if (upserted > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[audit.walReplayer] upserted=${upserted} (attempted=${attempted})`
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[audit.walReplayer] bulk upsert failed: ${(err as Error).message}`
      );
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      batch = [];
    }
  };

  try {
    for await (const line of rl) {
      const s = line.trim();
      if (!s) continue;
      try {
        batch.push(JSON.parse(s) as AuditEvent);
        if (batch.length >= REPLAY_BATCH) await flush();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[audit.walReplayer] JSON parse error in ${path.basename(
            fullPath
          )}: ${(err as Error).message}`
        );
      }
    }
    await flush();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[audit.walReplayer] stream error: ${(err as Error).message}`
    );
  } finally {
    rl.close();
    stream.close();
  }

  // eslint-disable-next-line no-console
  console.info(
    `[audit.walReplayer] Done ${path.basename(fullPath)} (lines=${count})`
  );
  return count;
}
