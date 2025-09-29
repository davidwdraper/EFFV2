/**
 * NowVibin — Backend
 * File: backend/services/audit/src/bootstrap/walReplayer.ts
 * Service: audit
 *
 * Why:
 *   Replay Write-Ahead Log (NDJSON) into Mongo on startup (before serving traffic).
 *   - INSERT-ONLY semantics, ignore duplicates via unique(eventId).
 *   - Processes files sequentially; within a file, batches by AUDIT_BATCH_MAX.
 *
 * Notes:
 *   - WAL directory is derived from env (AUDIT_WAL_DIR) or dev default.
 *   - File format: audit-YYYYMMDD.ndjson (one JSON object per line).
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import readline from "readline";
import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import { insertBatch } from "../repo/auditEventRepo";

// ---------- Env helpers (kept consistent with services/wal.ts) ---------------

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

const BATCH_MAX = Number(process.env.AUDIT_BATCH_MAX || "500");

// ---------- Cursor (offset) persistence --------------------------------------
// We keep a single JSON file with per-file byte offsets. This prevents re-reading
// already-applied lines on every restart while still being robust to file rotation.

type ReplayCursor = {
  // map: absolute file path -> byte offset (number)
  files: Record<string, number>;
};

const CURSOR_PATH = path.join(WAL_DIR, "audit.replay.offset.json");

async function readCursor(): Promise<ReplayCursor> {
  try {
    const raw = await fsp.readFile(CURSOR_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.files) {
      return { files: parsed.files as Record<string, number> };
    }
  } catch {
    /* first boot or missing cursor */
  }
  return { files: {} };
}

async function writeCursor(cur: ReplayCursor): Promise<void> {
  await fsp.mkdir(WAL_DIR, { recursive: true });
  await fsp.writeFile(CURSOR_PATH, JSON.stringify(cur, null, 2), "utf8");
}

async function getOffset(cur: ReplayCursor, file: string): Promise<number> {
  return cur.files[file] ?? 0;
}

async function setOffset(
  cur: ReplayCursor,
  file: string,
  offset: number
): Promise<void> {
  cur.files[file] = Math.max(0, offset);
  await writeCursor(cur);
}

// ---------- Utilities ---------------------------------------------------------

function isWalFile(name: string) {
  return /^audit-\d{8}\.ndjson$/.test(name);
}

export async function listWalFiles(): Promise<string[]> {
  const names = (await fsp.readdir(WAL_DIR).catch(() => [])) as string[];
  return names
    .filter(isWalFile)
    .map((n) => path.join(WAL_DIR, n))
    .sort();
}

export function walDirPath() {
  return WAL_DIR;
}

// ---------- Replay core -------------------------------------------------------

async function replayFromOffset(
  fullPath: string,
  startOffset: number
): Promise<{
  attempted: number;
  inserted: number;
  duplicates: number;
  failedLines: number;
  nextOffset: number;
}> {
  const stats = {
    attempted: 0,
    inserted: 0,
    duplicates: 0,
    failedLines: 0,
    nextOffset: startOffset,
  };

  if (!fs.existsSync(fullPath)) return stats;

  // Open the file and create a Readable stream starting from startOffset.
  const fh = await fsp.open(fullPath, "r");
  const stream = fh.createReadStream({
    encoding: "utf8",
    start: startOffset,
  });

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let batch: AuditEvent[] = [];
  let bytesSeen = 0;

  async function flush() {
    if (!batch.length) return;
    const res = await insertBatch(batch);
    stats.attempted += res.attempted;
    stats.inserted += res.inserted;
    stats.duplicates += res.duplicates;
    batch = [];
  }

  for await (const line of rl) {
    // Count bytes (line + \n). For UTF-8, Buffer.byteLength is safest.
    const raw = line + "\n";
    bytesSeen += Buffer.byteLength(raw, "utf8");

    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed) as AuditEvent;
      batch.push(evt);
      if (batch.length >= BATCH_MAX) {
        await flush();
      }
    } catch {
      stats.failedLines += 1;
    }
  }

  await flush();

  // Compute nextOffset as the last read byte
  stats.nextOffset = startOffset + bytesSeen;

  await rl.close();
  await fh.close();

  return stats;
}

export async function replayWalFile(fullPath: string): Promise<{
  attempted: number;
  inserted: number;
  duplicates: number;
  failedLines: number;
}> {
  const cur = await readCursor();
  const startOffset = await getOffset(cur, fullPath);

  const res = await replayFromOffset(fullPath, startOffset);

  // Advance cursor only forward (idempotent safety)
  if (res.nextOffset > startOffset) {
    await setOffset(cur, fullPath, res.nextOffset);
  }

  return {
    attempted: res.attempted,
    inserted: res.inserted,
    duplicates: res.duplicates,
    failedLines: res.failedLines,
  };
}

export async function replayAllWalFiles(): Promise<{
  files: number;
  attempted: number;
  inserted: number;
  duplicates: number;
  failedLines: number;
}> {
  const files = await listWalFiles();
  const agg = {
    files: files.length,
    attempted: 0,
    inserted: 0,
    duplicates: 0,
    failedLines: 0,
  };

  for (const f of files) {
    const res = await replayWalFile(f);
    agg.attempted += res.attempted;
    agg.inserted += res.inserted;
    agg.duplicates += res.duplicates;
    agg.failedLines += res.failedLines;
  }

  return agg;
}
