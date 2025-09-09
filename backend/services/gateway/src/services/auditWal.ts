// backend/services/gateway/src/services/auditWal.ts
import fs from "fs";
import path from "path";
import os from "os";
import { setTimeout as delay } from "timers/promises";
import type { AuditEvent, WalConfig } from "../types/audit";
import { sendBatch } from "./auditDispatch";
import { logger as sharedLogger } from "@shared/utils/logger";

const logger = sharedLogger.child({ svc: "gateway", mod: "auditWal" });

let CFG: WalConfig;

// In-memory ring buffer (bounded)
const ring: AuditEvent[] = [];
let ringSize = 0;

// Timer
let flushTimer: NodeJS.Timeout | null = null;

// WAL file state
let currentFilePath = "";
let currentFileBytes = 0;
let currentDay = dayKey();
let cursorPath = "";
let inReplay = false;

// Public API
export function initWalFromEnv() {
  CFG = {
    dir: process.env.WAL_DIR || path.resolve(process.cwd(), "var/audit"),
    fileMaxMB: toInt(process.env.WAL_FILE_MAX_MB, 64),
    retentionDays: toInt(process.env.WAL_RETENTION_DAYS, 7),
    ringMaxEvents: toInt(process.env.WAL_RING_MAX_EVENTS, 50000),
    batchSize: toInt(process.env.WAL_BATCH_SIZE, 200),
    flushMs: toInt(process.env.WAL_FLUSH_MS, 1000),
    maxRetryMs: toInt(process.env.WAL_MAX_RETRY_MS, 30000),
    dropAfterMB: toInt(process.env.WAL_DROP_AFTER_MB, 512),
  };

  fs.mkdirSync(CFG.dir, { recursive: true });
  rotateIfNeeded(true);
  cursorPath = path.join(CFG.dir, ".offset");

  // Housekeeping
  pruneOldFiles().catch(() => void 0);

  // Best-effort replay on boot
  replayFromCursor().catch((err) =>
    logger.warn({ err }, "replay failed (continuing)")
  );
}

export function enqueueAudit(ev: AuditEvent) {
  try {
    // Ring buffer (drop oldest under pressure)
    ring.push(ev);
    ringSize++;
    if (ringSize > CFG.ringMaxEvents) {
      ring.shift();
      ringSize = CFG.ringMaxEvents;
      logger.warn("ring overflow: dropped oldest audit event");
    }

    // Append NDJSON
    const line = JSON.stringify(ev) + os.EOL;
    ensureRotateForAppend(Buffer.byteLength(line, "utf8"));
    fs.appendFileSync(currentFilePath, line, "utf8");
    currentFileBytes += Buffer.byteLength(line, "utf8");

    scheduleFlush();
  } catch (err) {
    logger.warn({ err }, "enqueue failed");
  }
}

// Tests can call
export async function forceFlush(reason = "manual") {
  await flush(reason);
}

// Internals
function toInt(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : d;
}
function dayKey(d: Date = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function makeFilePath() {
  return path.join(CFG.dir, `audit-${currentDay}.ndjson`);
}
function ensureRotateForAppend(nextBytes: number) {
  const maxBytes = CFG.fileMaxMB * 1024 * 1024;
  if (currentDay !== dayKey() || currentFileBytes + nextBytes > maxBytes) {
    rotateIfNeeded(false);
  }
}
function rotateIfNeeded(onInit: boolean) {
  currentDay = dayKey();
  currentFilePath = makeFilePath();
  if (!fs.existsSync(currentFilePath)) {
    fs.writeFileSync(currentFilePath, "", "utf8");
    currentFileBytes = 0;
    if (!onInit) logger.info({ file: currentFilePath }, "rotated WAL file");
  } else {
    currentFileBytes = fs.statSync(currentFilePath).size;
  }
}
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush("timer").catch((err) => logger.warn({ err }, "flush error"));
  }, CFG.flushMs);
}
async function flush(_reason: string) {
  if (inReplay) return;
  if (ring.length === 0) return;

  const batch = ring.splice(0, Math.min(CFG.batchSize, ring.length));
  ringSize = ring.length;

  const res = await sendBatch(batch);
  if (res.ok) {
    writeCursor({ ts: Date.now() });
    return;
  }

  if (res.retriable) {
    ring.unshift(...batch);
    ringSize = ring.length;
    const wait = Math.min(CFG.maxRetryMs, 500 + Math.random() * 2000);
    await delay(wait);
    scheduleFlush();
  } else {
    logger.warn(
      { status: res.status, err: res.error },
      "dropping non-retriable audit batch"
    );
  }
}

async function replayFromCursor() {
  inReplay = true;
  try {
    const cur = readCursor();
    const files = fs
      .readdirSync(CFG.dir)
      .filter((f) => f.startsWith("audit-") && f.endsWith(".ndjson"))
      .sort();

    let replayed = 0;
    for (const f of files) {
      const full = path.join(CFG.dir, f);
      const st = fs.statSync(full);
      if (cur?.ts && st.mtimeMs <= cur.ts) continue;

      const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
      const events: AuditEvent[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          // skip corrupt line
        }
        if (events.length >= CFG.batchSize) {
          await sendBatch(events.splice(0, events.length));
        }
      }
      if (events.length) await sendBatch(events);

      replayed++;
      writeCursor({ ts: st.mtimeMs });
    }
    logger.info({ replayed }, "replay complete");
  } catch (err) {
    logger.warn({ err }, "replay failed");
  } finally {
    inReplay = false;
  }
}

function writeCursor(data: { ts: number }) {
  try {
    fs.writeFileSync(cursorPath, JSON.stringify(data), "utf8");
  } catch {
    /* ignore */
  }
}
function readCursor(): { ts: number } | null {
  try {
    return JSON.parse(fs.readFileSync(cursorPath, "utf8"));
  } catch {
    return null;
  }
}

async function pruneOldFiles() {
  try {
    const cutoff = Date.now() - CFG.retentionDays * 86400 * 1000;
    for (const f of fs.readdirSync(CFG.dir)) {
      if (!f.startsWith("audit-") || !f.endsWith(".ndjson")) continue;
      const full = path.join(CFG.dir, f);
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) fs.unlinkSync(full);
    }
    const totalMB = dirSizeMB(CFG.dir);
    if (totalMB > CFG.dropAfterMB) {
      logger.warn({ totalMB, cap: CFG.dropAfterMB }, "WAL over soft cap");
    }
  } catch {
    /* ignore */
  }
}
function dirSizeMB(dir: string) {
  let bytes = 0;
  for (const f of fs.readdirSync(dir)) {
    try {
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile()) bytes += st.size;
    } catch {
      /* ignore */
    }
  }
  return Math.round(bytes / (1024 * 1024));
}
