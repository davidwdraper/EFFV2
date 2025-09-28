/**
 * Docs:
 * - Design: docs/design/backend/gateway/audit-wal.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *
 * Why:
 * - Durable, non-blocking audit WAL with rotation, retention, and crash-safe replay.
 * - At-least-once semantics; downstream does idempotent dedupe.
 * - EVENT-DRIVEN: no periodic polling; flush on enqueue and on replay, with
 *   bounded backoff on retriable failures only while there is pending data.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import { logger } from "@eff/shared/src/utils/logger";
import { sendBatch } from "./auditDispatch"; // <- removed nextBackoffMs import

type WalCfg = {
  dir: string;
  maxFileMB: number;
  retentionDays: number;
  ringMaxEvents: number;
  batchSize: number;
  dropAfterMB: number;
};

const cfg: WalCfg = {
  dir: process.env.WAL_DIR || "./var/audit",
  maxFileMB: num(process.env.WAL_FILE_MAX_MB, 64),
  retentionDays: num(process.env.WAL_RETENTION_DAYS, 7),
  ringMaxEvents: num(process.env.WAL_RING_MAX_EVENTS, 50000),
  batchSize: num(process.env.WAL_BATCH_SIZE, 200),
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
  private sending = false;
  private attempt = 0;
  private cursor: LineMeta | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    await fsp.mkdir(cfg.dir, { recursive: true });
    await this.rotateIfNeeded(true);
    await this.loadCursor();
    // No periodic timer: we rely on enqueue-triggered flush and startup replay.
    void this.replayFromCursor();
    void this.cleanupOldFiles();
    logger.info(
      { dir: cfg.dir, mode: "event-driven" },
      "[auditWal] initialized"
    );
  }

  snapshot() {
    return {
      dir: cfg.dir,
      currentFile: this.currentFile,
      ringSize: this.ring.length,
      batchSize: cfg.batchSize,
      cursor: this.cursor
        ? { file: this.cursor.file, pos: this.cursor.pos }
        : null,
      sending: this.sending,
      attempt: this.attempt,
      retryTimerActive: !!this.retryTimer,
    };
  }

  enqueue(ev: AuditEvent) {
    const line = JSON.stringify(ev) + "\n";
    this.ensureWriter();
    this.writer!.write(line);

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

    // Event-driven: try to flush immediately.
    this.flush("enqueue");
  }

  flush(reason: string) {
    // If already sending or waiting a scheduled retry, do nothing.
    if (this.sending || this.retryTimer) return;

    if (this.ring.length === 0) {
      logger.debug({ reason }, "[auditWal] flush skipped (empty ring)");
      return;
    }

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
            { sent: toSend.length, status: res.status, reason },
            "[auditWal] batch sent"
          );
        } else if (!res.retriable) {
          // Drop poison batch; do not advance cursor (so WAL replay can decide).
          this.ring.splice(0, toSend.length);
          logger.warn(
            { status: res.status, dropped: toSend.length, reason },
            "[auditWal] non-retriable; dropped from ring (cursor unchanged)"
          );
        } else {
          const wait = nextBackoffMs(++this.attempt);
          logger.warn(
            { status: res.status, attempt: this.attempt, wait, reason },
            "[auditWal] retriable failure; scheduling retry"
          );
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.flush("retry");
          }, wait);
          return; // keep sending=true until finally
        }
      } catch (err) {
        const wait = nextBackoffMs(++this.attempt);
        logger.warn(
          { err, attempt: this.attempt, wait, reason },
          "[auditWal] error sending; scheduling retry"
        );
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.flush("retry");
        }, wait);
        return;
      } finally {
        this.sending = false;
        // Keep draining if we still have items and no retry is pending.
        if (this.ring.length > 0 && !this.retryTimer) {
          this.flush("drain-continue");
        }
      }
    })();
  }

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
            // Skip poison batch; advance cursor to avoid replay storms.
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

    // Best-effort fsync at rotation boundary
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

// Helpers

/** Exponential backoff with jitter; capped. attempt starts at 1. */
function nextBackoffMs(attempt: number): number {
  const BASE = 250; // 250ms, 500, 1000, 2000, 4000...
  const MAX = 10000; // cap at 10s
  const exp = Math.min(MAX, BASE * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = 0.9 + Math.random() * 0.2; // ±10% jitter
  return Math.floor(exp * jitter);
}

function fmtYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

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

// Public API (singleton)
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
