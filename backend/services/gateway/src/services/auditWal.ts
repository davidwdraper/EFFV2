// backend/services/gateway/src/services/auditWal.ts
/**
 * References:
 * - SOP v4 — WAL durability + replay; never block foreground traffic
 * - Session — expose walSnapshot() for /__audit; visible debug/info logs on activity
 *
 * Why:
 * Durable write-ahead log for billable audit:
 *   • Append NDJSON per event (non-blocking), ring buffer for batching
 *   • Daily/size rotation, .offset cursor, crash-safe replay on boot
 *   • Fire-and-forget dispatch with backoff; never stalls user requests
 *
 * Type note:
 * Node’s `FileHandle` type is in `fs/promises`, not `fs`. We import it from
 * `"node:fs/promises"` and use it wherever we do positioned reads.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AuditEvent } from "@shared/src/contracts/auditEvent.contract";
import { logger } from "@shared/utils/logger";
import { sendBatch, nextBackoffMs } from "./auditDispatch";

type WalCfg = {
  dir: string;
  maxFileMB: number;
  retentionDays: number;
  ringMaxEvents: number;
  batchSize: number;
  flushMs: number;
  maxRetryMs: number;
  dropAfterMB: number;
};

const cfg: WalCfg = {
  dir: process.env.WAL_DIR || "./var/audit",
  maxFileMB: num(process.env.WAL_FILE_MAX_MB, 64),
  retentionDays: num(process.env.WAL_RETENTION_DAYS, 7),
  ringMaxEvents: num(process.env.WAL_RING_MAX_EVENTS, 50000),
  batchSize: num(process.env.WAL_BATCH_SIZE, 200),
  flushMs: num(process.env.WAL_FLUSH_MS, 1000),
  maxRetryMs: num(process.env.WAL_MAX_RETRY_MS, 30000),
  dropAfterMB: num(process.env.WAL_DROP_AFTER_MB, 512),
};

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}

type LineMeta = { file: string; pos: number; len: number };

class AuditWal {
  private ring: AuditEvent[] = [];
  private writer: fs.WriteStream | null = null;
  private currentFile = "";
  private timer: NodeJS.Timeout | null = null;
  private sending = false;
  private attempt = 0;
  private cursor: LineMeta | null = null;

  async init(): Promise<void> {
    await fsp.mkdir(cfg.dir, { recursive: true });
    await this.rotateIfNeeded(true);
    await this.loadCursor();
    this.scheduleFlush();
    void this.replayFromCursor();
    void this.cleanupOldFiles();
    logger.info({ dir: cfg.dir }, "[auditWal] initialized");
  }

  /** Snapshot for /__audit diagnostics (non-billable). */
  snapshot() {
    return {
      dir: cfg.dir,
      currentFile: this.currentFile,
      ringSize: this.ring.length,
      flushMs: cfg.flushMs,
      batchSize: cfg.batchSize,
      cursor: this.cursor
        ? { file: this.cursor.file, pos: this.cursor.pos }
        : null,
      sending: this.sending,
      attempt: this.attempt,
    };
  }

  enqueue(ev: AuditEvent) {
    // Append NDJSON line (non-blocking write stream)
    const line = JSON.stringify(ev) + "\n";
    this.ensureWriter();
    this.writer!.write(line);

    // Ring buffer for batching
    this.ring.push(ev);
    if (this.ring.length > cfg.ringMaxEvents) {
      this.ring.shift();
      logger.warn(
        { ring: cfg.ringMaxEvents },
        "[auditWal] ring buffer at capacity; dropping oldest"
      );
    }

    logger.debug(
      { ringSize: this.ring.length, batchSize: cfg.batchSize },
      "[auditWal] enqueued"
    );

    if (this.ring.length >= cfg.batchSize) this.flush("batchSize");
  }

  flush(_reason: string) {
    if (this.sending) return;
    if (this.ring.length === 0) return;
    this.sending = true;

    const toSend = this.ring.slice(0, cfg.batchSize);

    void (async () => {
      try {
        const res = await sendBatch(toSend);
        if (res.ok) {
          await this.advanceCursorByEvents(toSend.length);
          this.ring.splice(0, toSend.length);
          this.attempt = 0;
          logger.info(
            { sent: toSend.length, status: res.status },
            "[auditWal] batch sent"
          );
        } else if (!res.retriable) {
          this.ring.splice(0, toSend.length);
          logger.warn(
            { status: res.status, dropped: toSend.length },
            "[auditWal] non-retriable; dropped from ring (cursor unchanged)"
          );
        } else {
          const wait = nextBackoffMs(++this.attempt);
          logger.warn(
            { status: res.status, attempt: this.attempt, wait },
            "[auditWal] retriable failure; will retry"
          );
          await delay(wait);
        }
      } catch (err) {
        const wait = nextBackoffMs(++this.attempt);
        logger.warn(
          { err, attempt: this.attempt, wait },
          "[auditWal] error sending; will retry"
        );
        await delay(wait);
      } finally {
        this.sending = false;
        this.scheduleFlush();
      }
    })();
  }

  // ── Boot replay from .offset ────────────────────────────────────────────────

  private async replayFromCursor() {
    try {
      const { file, startPos } = await this.cursorInfo();
      if (!file) return;

      let fd: FileHandle | null = null;
      try {
        fd = await fsp.open(file, "r");
        let pos = startPos;

        for (;;) {
          const chunk = await readLines(fd, pos, cfg.batchSize);
          if (chunk.lines.length === 0) break;

          const toSend = chunk.lines.map((l) => JSON.parse(l) as AuditEvent);
          const res = await sendBatch(toSend);
          if (res.ok) {
            pos = chunk.nextPos;
            await this.saveCursor({ file, pos, len: 0 });
            logger.info(
              { count: toSend.length, file, pos },
              "[auditWal] replay advanced"
            );
          } else if (!res.retriable) {
            pos = chunk.nextPos;
            await this.saveCursor({ file, pos, len: 0 });
            logger.warn(
              { status: res.status, skipped: toSend.length, pos },
              "[auditWal] replay skipped poison batch"
            );
          } else {
            const wait = nextBackoffMs(++this.attempt);
            logger.warn(
              { status: res.status, attempt: this.attempt, wait },
              "[auditWal] replay retriable; waiting"
            );
            await delay(wait);
          }
        }
      } finally {
        await fd?.close().catch(() => {});
      }
    } catch (err) {
      logger.error({ err }, "[auditWal] replay failed");
    }
  }

  // ── Writers, rotation, cursor ──────────────────────────────────────────────

  private ensureWriter() {
    if (this.writer && !this.writer.closed) return;
    this.rotateIfNeeded().catch((err) => {
      logger.error({ err }, "[auditWal] rotateIfNeeded failed");
    });
  }

  private async rotateIfNeeded(forceNew = false) {
    const now = new Date();
    const name = `audit-${fmtYmd(now)}.ndjson`;
    const file = path.join(cfg.dir, name);

    if (!forceNew && this.currentFile === file) {
      try {
        const stat = await fsp.stat(file);
        const mb = stat.size / (1024 * 1024);
        if (mb < cfg.maxFileMB) return;
      } catch {
        /* file may not exist yet */
      }
    }

    if (this.writer) {
      await new Promise<void>((resolve) => {
        this.writer!.once("close", () => resolve());
      });
      this.writer.end();
      this.writer = null;
    }

    this.currentFile = file;
    this.writer = fs.createWriteStream(file, { flags: "a" });
    await new Promise<void>((resolve, reject) => {
      this.writer!.once("open", () => resolve());
      this.writer!.once("error", (e) => reject(e));
    });

    // fsync on rotate boundary (best-effort)
    try {
      const fd = await fsp.open(file, "r+");
      await fd.sync();
      await fd.close();
    } catch {
      /* ignore */
    }
  }

  private async loadCursor() {
    const p = path.join(cfg.dir, "audit.offset");
    try {
      const raw = await fsp.readFile(p, "utf8");
      const { file, pos } = JSON.parse(raw) as { file: string; pos: number };
      this.cursor = { file, pos, len: 0 };
    } catch {
      this.cursor = null;
    }
  }

  private async saveCursor(meta: LineMeta) {
    const p = path.join(cfg.dir, "audit.offset");
    await fsp.writeFile(p, JSON.stringify({ file: meta.file, pos: meta.pos }));
  }

  private async cursorInfo(): Promise<{
    file: string | null;
    startPos: number;
  }> {
    if (this.cursor && this.cursor.file) {
      return { file: this.cursor.file, startPos: this.cursor.pos };
    }
    if (!this.currentFile) {
      await this.rotateIfNeeded(true);
    }
    return { file: this.currentFile || null, startPos: 0 };
  }

  private async advanceCursorByEvents(n: number) {
    const { file, startPos } = await this.cursorInfo();
    if (!file) return;

    let fd: FileHandle | null = null;
    try {
      fd = await fsp.open(file, "r");
      let pos = startPos;
      let left = n;

      while (left > 0) {
        const { lines, nextPos } = await readLines(fd, pos, left);
        if (lines.length === 0) break;
        left -= lines.length;
        pos = nextPos;
      }
      await this.saveCursor({ file, pos, len: 0 });
    } catch (err) {
      logger.warn({ err }, "[auditWal] advanceCursorByEvents failed");
    } finally {
      await fd?.close().catch(() => {});
    }
  }

  private scheduleFlush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(() => this.flush("timer"), cfg.flushMs);
  }

  private async cleanupOldFiles() {
    try {
      const entries = await fsp.readdir(cfg.dir);
      const cutoff = Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000;
      await Promise.all(
        entries
          .filter((f) => f.startsWith("audit-") && f.endsWith(".ndjson"))
          .map(async (f) => {
            const full = path.join(cfg.dir, f);
            try {
              const st = await fsp.stat(full);
              if (st.mtime.getTime() < cutoff) {
                await fsp.unlink(full);
              }
            } catch {
              /* ignore */
            }
          })
      );
    } catch {
      /* ignore */
    }
  }
}

// ── File helpers ─────────────────────────────────────────────────────────────

function fmtYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Read up to `maxLines` NDJSON lines from file descriptor starting at byte `pos`.
 * Returns the lines and the byte offset of the next unread position.
 */
async function readLines(fd: FileHandle, pos: number, maxLines: number) {
  const CHUNK = 64 * 1024;
  let buf = Buffer.alloc(CHUNK);
  let acc = "";
  let lines: string[] = [];
  let offset = pos;

  while (lines.length < maxLines) {
    const { bytesRead } = await fd.read(buf, 0, CHUNK, offset);
    if (bytesRead <= 0) break;
    offset += bytesRead;
    acc += buf.slice(0, bytesRead).toString("utf8");

    const parts = acc.split("\n");
    acc = parts.pop() || "";
    for (const p of parts) {
      if (p.trim().length) lines.push(p);
      if (lines.length >= maxLines) break;
    }
  }

  if (acc.trim().length && lines.length < maxLines) {
    lines.push(acc);
    acc = "";
  }

  return { lines, nextPos: offset - Buffer.byteLength(acc, "utf8") };
}

// ── Public API ───────────────────────────────────────────────────────────────

let walSingleton: AuditWal | null = null;

export function initWalFromEnv() {
  if (walSingleton) return;
  walSingleton = new AuditWal();
  void walSingleton.init();
}

export function walEnqueue(ev: AuditEvent) {
  if (!walSingleton) initWalFromEnv();
  walSingleton!.enqueue(ev);
}

export function walSnapshot() {
  if (!walSingleton) return null;
  return walSingleton.snapshot();
}
