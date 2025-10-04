// backend/shared/src/util/logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Minimal shared logger that prints human-friendly, one-line logs:
 *   "LEVEL YYYY-MM-DD HH:MM:SS <slug> v<version> <url>"
 * - Adds a dedicated EDGE channel (toggle via LOG_EDGE) separate from LOG_LEVEL.
 *
 * Env:
 * - LOG_LEVEL  (optional) debug|info|warn|error|silent   [default: info]
 * - LOG_EDGE   (optional) 1|true|on enables EDGE logs     [default: off]
 * - SVC_NAME   (optional) included in structured fields if/when needed later
 *
 * Usage:
 *   import { log } from "@nv/shared/util/logger";
 *   const l = log.bind({ slug: "auth", version: 1, requestId, url: "/api/auth/v1/create" });
 *   l.info();        // INFO 2025-10-03 16:33:35 auth v1 /api/auth/v1/create
 *   l.edge();        // EDGE 2025-10-03 16:33:35 auth v1 /api/auth/v1/create   (only if LOG_EDGE=on)
 *   l.warn("slow");  // WARN 2025-10-03 16:33:35 auth v1 /api/auth/v1/create - slow
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
type CoreLevel = Exclude<LogLevel, "silent">;

export type BoundCtx = {
  slug: string;
  version?: number; // defaults to 1
  requestId?: string; // not printed in the base line
  url?: string; // prefer full URL; path ok if full is unavailable
};

const LEVEL_ORDER: Record<CoreLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase().trim();
  return (["debug", "info", "warn", "error", "silent"] as LogLevel[]).includes(
    raw as LogLevel
  )
    ? (raw as LogLevel)
    : "info";
}

function edgeEnabled(): boolean {
  const v = (process.env.LOG_EDGE ?? "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "on";
}

function levelEnabled(level: CoreLevel): boolean {
  const min = envLogLevel();
  if (min === "silent") return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min as CoreLevel];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local time "YYYY-MM-DD HH:MM:SS" */
function tsLocal(): string {
  const d = new Date();
  const Y = d.getFullYear();
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function printLine(levelUpper: string, ctx: BoundCtx, msg?: string): void {
  const v = ctx.version ?? 1;
  const url = ctx.url ?? "";
  const base = `${levelUpper} ${tsLocal()} ${ctx.slug} v${v}${
    url ? ` ${url}` : ""
  }`;
  const line = msg ? `${base} - ${msg}` : base;

  switch (levelUpper) {
    case "DEBUG":
      (console.debug ?? console.log)(line);
      break;
    case "INFO":
      console.log(line);
      break;
    case "WARN":
      console.warn(line);
      break;
    case "ERROR":
    case "EDGE": // treat EDGE like INFO for stream selection
      console.log(line);
      break;
    default:
      console.log(line);
  }
}

class Logger {
  // ---------- Unbound (rarely used directly) ----------
  static debug(msg?: string) {
    if (levelEnabled("debug"))
      printLine("DEBUG", { slug: "-", version: 1 }, msg);
  }
  static info(msg?: string) {
    if (levelEnabled("info")) printLine("INFO", { slug: "-", version: 1 }, msg);
  }
  static warn(msg?: string) {
    if (levelEnabled("warn")) printLine("WARN", { slug: "-", version: 1 }, msg);
  }
  static error(msg?: string) {
    if (levelEnabled("error"))
      printLine("ERROR", { slug: "-", version: 1 }, msg);
  }

  // ---------- Bind per-request context ----------
  static bind(ctx: BoundCtx) {
    const bound: BoundCtx = { ...ctx };

    return {
      debug(msg?: string) {
        if (!levelEnabled("debug")) return;
        printLine("DEBUG", bound, msg);
      },
      info(msg?: string) {
        if (!levelEnabled("info")) return;
        printLine("INFO", bound, msg);
      },
      warn(msg?: string) {
        if (!levelEnabled("warn")) return;
        printLine("WARN", bound, msg);
      },
      error(msg?: string) {
        if (!levelEnabled("error")) return;
        printLine("ERROR", bound, msg);
      },
      /** Dedicated EDGE channel — fully independent of LOG_LEVEL. */
      edge(msg?: string) {
        if (!edgeEnabled()) return;
        printLine("EDGE", bound, msg);
      },
    };
  }
}

export const log = Logger;
