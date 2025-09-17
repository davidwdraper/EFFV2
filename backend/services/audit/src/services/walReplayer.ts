// backend/services/audit/src/bootstrap/walReplayer.ts
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

function isWalFile(name: string) {
  return /^audit-\d{8}\.ndjson$/.test(name);
}

export async function replayWalFile(fullPath: string): Promise<{
  attempted: number;
  inserted: number;
  duplicates: number;
  failedLines: number;
}> {
  const stats = { attempted: 0, inserted: 0, duplicates: 0, failedLines: 0 };
  if (!fs.existsSync(fullPath)) return stats;

  const stream = fs.createReadStream(fullPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let batch: AuditEvent[] = [];

  async function flush() {
    if (!batch.length) return;
    const res = await insertBatch(batch);
    stats.attempted += res.attempted;
    stats.inserted += res.inserted;
    stats.duplicates += res.duplicates;
    batch = [];
  }

  for await (const line of rl) {
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
  rl.close();
  return stats;
}

export async function listWalFiles(): Promise<string[]> {
  const names = (await fsp.readdir(WAL_DIR).catch(() => [])) as string[];
  return names
    .filter(isWalFile)
    .map((n) => path.join(WAL_DIR, n))
    .sort();
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

export function walDirPath() {
  return WAL_DIR;
}
