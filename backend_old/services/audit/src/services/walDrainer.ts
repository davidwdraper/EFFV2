// backend/services/audit/src/services/walDrainer.ts
/**
 * NowVibin — Backend
 *
 * Why (single path for startup + live ingestion):
 *   Drain the WAL (NDJSON) into Mongo using ONE implementation. Both the
 *   startup preflight and the live API ingestion call into this module, so we
 *   never have two diverging “flushers”.
 *
 * Behavior:
 *   - Cursor { file, pos } is persisted alongside the WAL dir (cursor.json)
 *   - On "scheduleWalDrain", we drain from the cursor to EOF across all WAL files
 *   - Batches are inserted via repo.insertBatch (insert-only; duplicates ignored)
 *   - Safe reentrancy: if a drain is ongoing, we just mark "pending"
 *   - Optional periodic tail kicker (AUDIT_TAIL_INTERVAL_MS, default 1000ms)
 *   - **No-op guard:** the periodic tail *skips* draining if there is no work
 *     (cursor already at last file end, and no newer files).
 *
 * Files:
 *   WAL files: audit-YYYYMMDD.ndjson                (same path as wal.ts)
 *   Cursor:    <WAL_DIR>/cursor.json                (drainer-maintained)
 *
 * Envs:
 *   AUDIT_WAL_DIR                (same default as wal.ts)
 *   AUDIT_BATCH_MAX=500          (events per DB write)
 *   AUDIT_RETRY_BACKOFF_MS=1000  (backoff when DB fails)
 *   AUDIT_TAIL_INTERVAL_MS=1000  (periodic kicker; 0 disables)
 *
 * IMPORTANT (pino):
 *   Never destructure or store pino logger methods (e.g., `const { info } = logger`
 *   or `const fn = logger.info`). That loses `this` binding and crashes pino.
 *   Always call `logger.info(...)` / `logger.debug(...)` directly.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import readline from "readline";
import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import { insertBatch } from "../repo/auditEventRepo";
import { logger } from "@eff/shared/src/utils/logger";

// ──────────────────────────────────────────────────────────────────────────────
// Env / defaults (kept consistent with wal.ts)
// ──────────────────────────────────────────────────────────────────────────────

function isProd() {
  const env = String(process.env.NODE_ENV || "").toLowerCase();
  return env === "production" || env === "prod";
}

let devWarned = false;
function envOrDefault(name: string, def: string): string {
  const v = process.env[name];
  if (v && v.trim() !== "") return v.trim();
  if (isProd()) {
    throw new Error(`[walDrainer] Missing required env ${name}`);
  }
  if (!devWarned) {
    // eslint-disable-next-line no-console
    console.warn(
      "[walDrainer] Using development defaults; set AUDIT_* envs for prod."
    );
    devWarned = true;
  }
  return def;
}

const WAL_DIR = envOrDefault(
  "AUDIT_WAL_DIR",
  path.join(process.cwd(), "var", "audit-wal")
);

const BATCH_MAX = Number(process.env.AUDIT_BATCH_MAX || "500");
const RETRY_BACKOFF_MS = Number(process.env.AUDIT_RETRY_BACKOFF_MS || "1000");
const TAIL_INTERVAL_MS = Number(process.env.AUDIT_TAIL_INTERVAL_MS || "1000");

// ──────────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────────

type Cursor = { file: string; pos: number };

const CURSOR_PATH = path.join(WAL_DIR, "cursor.json");
const WAL_NAME_RE = /^audit-\d{8}\.ndjson$/;

let draining = false;
let pending = false;
let kicker: NodeJS.Timeout | null = null;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function listWalFiles(): Promise<string[]> {
  const names = (await fsp.readdir(WAL_DIR).catch(() => [])) as string[];
  return names
    .filter((n) => WAL_NAME_RE.test(n))
    .map((n) => path.join(WAL_DIR, n))
    .sort(); // ascending by date
}

async function statOrNull(p: string) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

async function readCursor(): Promise<Cursor | null> {
  try {
    const raw = await fsp.readFile(CURSOR_PATH, "utf8");
    const c = JSON.parse(raw) as Cursor;
    if (typeof c?.file === "string" && Number.isFinite(c?.pos)) return c;
  } catch {
    /* ignore */
  }
  return null;
}

async function writeCursor(cur: Cursor): Promise<void> {
  await fsp.mkdir(WAL_DIR, { recursive: true });
  await fsp.writeFile(CURSOR_PATH, JSON.stringify(cur));
}

function fileBase(p: string) {
  return path.basename(p);
}

// Read lines from [pos, ...) up to maxLines; returns { lines, nextPos, eof }
async function readLinesFrom(
  file: string,
  pos: number,
  maxLines: number
): Promise<{ lines: string[]; nextPos: number; eof: boolean }> {
  const stream = fs.createReadStream(file, {
    encoding: "utf8",
    start: pos,
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const lines: string[] = [];
  let nextPos = pos;

  for await (const chunk of rl) {
    lines.push(chunk);
    // estimate next pos by adding bytes read; fallback via stat at the end
    nextPos += Buffer.byteLength(chunk + "\n", "utf8");
    if (lines.length >= maxLines) break;
  }

  rl.close();

  const st = await statOrNull(file);
  const eof = !st || nextPos >= st.size;
  // Guard: if read nothing, ensure nextPos doesn't overshoot file size
  if (lines.length === 0 && st) nextPos = st.size;

  return { lines, nextPos, eof };
}

// Determine if there is work to drain:
// - No cursor yet but files exist → work
// - Cursor file missing but WAL files exist → work
// - Cursor before EOF on its file → work
// - Any newer file after cursor (with size > 0) → work
async function hasWorkToDrain(): Promise<{
  work: boolean;
  fromFile?: string;
  fromPos?: number;
  fileSize?: number;
}> {
  const files = await listWalFiles();
  if (!files.length) return { work: false };

  let cur = (await readCursor()) || { file: files[0], pos: 0 };

  // If cursor file no longer exists (rotated/pruned), treat as work from first file
  if (!files.includes(cur.file)) {
    return {
      work: true,
      fromFile: fileBase(files[0]),
      fromPos: 0,
      fileSize: 0,
    };
  }

  const idx = files.indexOf(cur.file);
  const st = await statOrNull(cur.file);
  const sz = st?.size ?? 0;

  if (cur.pos < sz) {
    return {
      work: true,
      fromFile: fileBase(cur.file),
      fromPos: cur.pos,
      fileSize: sz,
    };
  }

  // If there are newer files, check if any has data
  if (idx < files.length - 1) {
    for (let i = idx + 1; i < files.length; i++) {
      const s = await statOrNull(files[i]);
      if ((s?.size ?? 0) > 0) {
        return {
          work: true,
          fromFile: fileBase(files[i]),
          fromPos: 0,
          fileSize: s!.size,
        };
      }
    }
  }

  return {
    work: false,
    fromFile: fileBase(cur.file),
    fromPos: cur.pos,
    fileSize: sz,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Core drain loop
// ──────────────────────────────────────────────────────────────────────────────

async function drainOnce(reason: string): Promise<void> {
  const files = await listWalFiles();
  if (!files.length) return;

  let cur = (await readCursor()) || { file: files[0], pos: 0 };

  // If cursor file no longer exists (rotated/pruned), jump to earliest file
  if (!files.includes(cur.file)) {
    cur = { file: files[0], pos: 0 };
    await writeCursor(cur);
  }

  // Advance to the first existing file index
  let idx = files.indexOf(cur.file);
  if (idx < 0) idx = 0;

  // NOTE: We only log "start" at info when we expect to insert; otherwise debug
  logger.debug(
    {
      reason,
      fromFile: fileBase(files[idx]),
      fromPos: cur.pos,
      batchMax: BATCH_MAX,
    },
    "[walDrainer] drain start"
  );

  let insertedTotal = 0;
  let duplicatesTotal = 0;

  // Walk files from cursor forward
  for (; idx < files.length; idx++) {
    const file = files[idx];

    // If we moved to a new file, reset pos
    if (file !== cur.file) {
      cur = { file, pos: 0 };
      await writeCursor(cur);
    }

    // Loop until EOF for this file
    let eof = false;
    while (!eof) {
      const {
        lines,
        nextPos,
        eof: atEnd,
      } = await readLinesFrom(file, cur.pos, BATCH_MAX);

      if (!lines.length) {
        eof = atEnd;
        break;
      }

      // Parse to events
      const batch: AuditEvent[] = [];
      for (const line of lines) {
        const trimmed = String(line || "").trim();
        if (!trimmed) continue;
        try {
          batch.push(JSON.parse(trimmed) as AuditEvent);
        } catch {
          // malformed line — skip; cursor still advances
        }
      }

      // Persist batch (insert-only; dupes ignored)
      if (batch.length) {
        try {
          const res = await insertBatch(batch);
          insertedTotal += res.inserted;
          duplicatesTotal += res.duplicates;
          logger.info(
            {
              file: fileBase(file),
              inserted: res.inserted,
              duplicates: res.duplicates,
              nextPos,
            },
            "[walDrainer] batch persisted"
          );
        } catch (dbErr) {
          // Put us on a retry path; cursor not advanced (safer)
          const msg = (dbErr as Error).message;
          logger.warn(
            { file: fileBase(file), err: msg, retryMs: RETRY_BACKOFF_MS },
            "[walDrainer] DB insert failed; will retry"
          );
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
          // rethrow to break outer loop; caller schedules again
          throw dbErr;
        }
      }

      // Advance cursor after DB success (or empty batch)
      cur.pos = nextPos;
      await writeCursor(cur);

      eof = atEnd;
    }
  }

  // IMPORTANT: do NOT save a method ref; call the logger method directly
  if (insertedTotal > 0 || duplicatesTotal > 0) {
    logger.info(
      {
        reason,
        inserted: insertedTotal,
        duplicates: duplicatesTotal,
        lastFile: fileBase(cur.file),
        lastPos: cur.pos,
      },
      "[walDrainer] drain complete"
    );
  } else {
    logger.debug(
      {
        reason,
        inserted: insertedTotal,
        duplicates: duplicatesTotal,
        lastFile: fileBase(cur.file),
        lastPos: cur.pos,
      },
      "[walDrainer] drain complete"
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
export function initWalDrainer(): void {
  if (kicker) return;

  if (TAIL_INTERVAL_MS > 0) {
    kicker = setInterval(async () => {
      const stat = await hasWorkToDrain();
      if (!stat.work) {
        // nothing to do; keep quiet to avoid noisy logs
        return;
      }
      scheduleWalDrain("tail");
    }, TAIL_INTERVAL_MS);
    logger.info(
      { intervalMs: TAIL_INTERVAL_MS, walDir: WAL_DIR },
      "[walDrainer] periodic tail enabled"
    );
  } else {
    logger.info(
      { intervalMs: 0, walDir: WAL_DIR },
      "[walDrainer] periodic tail disabled"
    );
  }
}

export function scheduleWalDrain(reason: "ingest" | "tail" | "startup"): void {
  if (draining) {
    pending = true;
    return;
  }
  draining = true;

  void (async () => {
    try {
      // Tail-triggered drains also guard again (in case work vanished)
      if (reason === "tail") {
        const stat = await hasWorkToDrain();
        if (!stat.work) {
          draining = false;
          if (pending) {
            pending = false;
            // no immediate reschedule — let kicker run next tick
          }
          return;
        }
      }
      await drainOnce(reason);
    } catch (err) {
      logger.warn({ err }, "[walDrainer] drain error");
    } finally {
      draining = false;
      if (pending) {
        pending = false;
        // chain one more drain; classify as tail
        scheduleWalDrain("tail");
      }
    }
  })();
}

/** Used by preflight bootstrap to do a blocking drain before serving traffic. */
export async function drainAllPendingNow(): Promise<void> {
  // Run a drain and wait; if more appends happen immediately, the periodic tail or API kicks will handle them
  const stat = await hasWorkToDrain();
  if (!stat.work) return;
  await drainOnce("startup");
}
