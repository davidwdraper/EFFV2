// backend/services/audit/src/services/wal.ts
/**
 * Docs:
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Scaling: docs/architecture/backend/SCALING.md
 * - ADRs: docs/adr/0001-audit-wal-and-batching.md
 *
 * Why:
 * - Write-Ahead Log (WAL) gives us durability-before-DB: we never lose an event
 *   between intake and persistence. We append NDJSON lines to a per-day file,
 *   then enqueue for DB. WAL replay (via unified walDrainer) idempotently backfills.
 *
 * Notes:
 * - Append-only, one file per UTC day (keeps ops simple).
 * - We *await* the append in the handler before returning 202.
 * - Rotation here is advisory (warns when large); ops can also use logrotate.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { logger } from "@eff/shared/src/utils/logger";

// ---------- Env helpers ------------------------------------------------------

function isProd() {
  const env = String(process.env.NODE_ENV || "").toLowerCase();
  return env === "production" || env === "prod";
}

let devWarned = false;
function envOrDefault(name: string, def: string): string {
  const v = process.env[name];
  if (v && v.trim() !== "") return v.trim();
  if (isProd()) {
    throw new Error(`[audit.wal] Missing required env ${name}`);
  }
  if (!devWarned) {
    // eslint-disable-next-line no-console
    console.warn(
      "[audit.wal] Using development defaults; set AUDIT_WAL_* for prod."
    );
    devWarned = true;
  }
  return def;
}

const WAL_DIR = envOrDefault(
  "AUDIT_WAL_DIR",
  path.join(process.cwd(), "var", "audit-wal")
);
const MAX_MB = Number(envOrDefault("AUDIT_WAL_MAX_MB", "512")); // advisory: warn if exceeded
const MAX_DAYS = Number(envOrDefault("AUDIT_WAL_MAX_DAYS", "7")); // advisory: prune older files

// ---------- Internals --------------------------------------------------------

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

/** UTC daily filename: audit-YYYYMMDD.ndjson */
function walFileNameFor(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return path.join(WAL_DIR, `audit-${yyyy}${mm}${dd}.ndjson`);
}

/**
 * Best-effort maintenance:
 * - Warn if today's file exceeds MAX_MB.
 * - Prune files older than MAX_DAYS (by mtime). Failures are swallowed.
 * WHY not delete after replay? Idempotency makes replays harmless; retention policy is centralized here.
 */
async function rotateAndPrune(): Promise<void> {
  try {
    // Size advisory for today's file
    const today = walFileNameFor(new Date());
    const st = await fsp.stat(today).catch(() => null as any);
    if (st && st.size > MAX_MB * 1024 * 1024) {
      // eslint-disable-next-line no-console
      console.warn(
        `[audit.wal] WAL file ${path.basename(today)} ≈ ${Math.round(
          st.size / (1024 * 1024)
        )}MB (> ${MAX_MB}MB). Consider rotating.`
      );
    }

    // Retention prune
    const entries = await fsp.readdir(WAL_DIR).catch(() => [] as string[]);
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    await Promise.all(
      entries
        .filter((f) => /^audit-\d{8}\.ndjson$/.test(f))
        .map(async (f) => {
          const full = path.join(WAL_DIR, f);
          const s = await fsp.stat(full).catch(() => null as any);
          if (s && s.mtimeMs < cutoff) {
            try {
              await fsp.unlink(full);
            } catch {
              /* ignore */
            }
          }
        })
    );
  } catch {
    /* never throw from maintenance */
  }
}

// ---------- Public API -------------------------------------------------------

/**
 * Append a batch of events as NDJSON lines to today's WAL.
 * - We write the whole batch in a single append syscall to preserve order.
 * - Each event is JSON.stringify'ed; a trailing newline is added.
 * - The handler AWAITS this before enqueueing, so a 202 means "safely on disk".
 */
export async function walAppend(
  events: Array<Record<string, unknown>>
): Promise<void> {
  if (!Array.isArray(events) || events.length === 0) return;

  await ensureDir(WAL_DIR);

  const file = walFileNameFor(new Date());
  const payload = events.map((e) => JSON.stringify(e)).join("\n") + "\n";

  try {
    await fsp.appendFile(file, payload, {
      encoding: "utf8",
      mode: 0o640,
      flag: "a",
    });
    logger.debug(
      { file: path.basename(file), count: events.length },
      "[audit.wal] append ok"
    );
  } catch (err) {
    const e = err as Error;
    e.message = `[audit.wal] append failed (${file}): ${e.message}`;
    throw e;
  }

  // Fire-and-forget maintenance (advisory)
  void rotateAndPrune().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[audit.wal] rotate/prune error: ${(err as Error).message}`);
  });
}

/**
 * Simple sync check used by readiness: verifies WAL dir is writable.
 * - Do NOT call on hot path; readiness only.
 */
export function canWriteWalDirSync(dir = WAL_DIR): boolean {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
