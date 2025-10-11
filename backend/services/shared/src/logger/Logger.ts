// backend/services/shared/src/logger/Logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0016 (Logging Architecture & Runtime Config)
 *   - ADR-0018 (Debug Log Origin Capture)
 *   - ADR-0006 (Gateway Edge Logging — first-class edge() channel)
 *
 * Purpose:
 * - Single shared logging API for all services with contextual .bind().
 * - Overloaded methods allow:
 *     log.info("msg")            OR  log.info({ctx}, "msg")
 *     log.info("msg", {meta})    OR  log.info({meta}, "msg")
 * - debug() adds origin capture (file/method/line).
 *
 * Env Toggles:
 * - LOG_DEBUG_ORIGIN=true|false  (default true)
 * - LOG_EDGE_ENABLED=true|false  (default true)
 *
 * Change:
 * - Print "***ERROR***" for error lines and "**WARN" for warnings (fallback console formatter).
 */

type Json = Record<string, unknown>;

/** Canonical logger contract — edge() is first class, not optional. */
export interface ILogger {
  // edge
  edge(msg: string, ...rest: unknown[]): void;
  edge(obj: Json, msg?: string, ...rest: unknown[]): void;

  // info
  info(msg: string, ...rest: unknown[]): void;
  info(obj: Json, msg?: string, ...rest: unknown[]): void;

  // debug
  debug(msg: string, ...rest: unknown[]): void;
  debug(obj: Json, msg?: string, ...rest: unknown[]): void;

  // warn
  warn(msg: string, ...rest: unknown[]): void;
  warn(obj: Json, msg?: string, ...rest: unknown[]): void;

  // error
  error(msg: string, ...rest: unknown[]): void;
  error(obj: Json, msg?: string, ...rest: unknown[]): void;
}

/** Public interface for bound logger handles (no private members). */
export interface IBoundLogger {
  bind(ctx: Record<string, unknown>): IBoundLogger;

  edge(msg: string, ...rest: unknown[]): void;
  edge(obj: Json, msg?: string, ...rest: unknown[]): void;

  info(msg: string, ...rest: unknown[]): void;
  info(obj: Json, msg?: string, ...rest: unknown[]): void;

  debug(msg: string, ...rest: unknown[]): void;
  debug(obj: Json, msg?: string, ...rest: unknown[]): void;

  warn(msg: string, ...rest: unknown[]): void;
  warn(obj: Json, msg?: string, ...rest: unknown[]): void;

  error(msg: string, ...rest: unknown[]): void;
  error(obj: Json, msg?: string, ...rest: unknown[]): void;

  serializeError(err: unknown): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Root logger installation
// ────────────────────────────────────────────────────────────────────────────

let ROOT: ILogger | null = null;

/** Local-time timestamp "YYYY-MM-DD HH:mm:ss". */
function tsLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Create a prefixed console writer for a given level tag. */
function writer(tag: "EDGE" | "INFO" | "DEBUG" | "WARN" | "ERROR") {
  const c =
    tag === "ERROR"
      ? console.error
      : tag === "WARN"
      ? console.warn
      : tag === "DEBUG"
      ? console.debug
      : console.log;

  const displayTag =
    tag === "ERROR" ? "***ERROR***" : tag === "WARN" ? "**WARN" : tag;

  return (obj: Json, msg?: string, ...rest: unknown[]) => {
    const prefix = `${displayTag} ${tsLocal()}`;
    if (msg !== undefined) c(prefix, msg, obj, ...rest);
    else c(prefix, obj, ...rest);
  };
}

/** Normalize any console/pino-like logger to our overloaded ILogger shape. */
function normalizeRoot(logger: Partial<ILogger>): ILogger {
  // Fallback with prefixed, timestamped output
  const fbEdge = writer("EDGE");
  const fbInfo = writer("INFO");
  const fbDebug = writer("DEBUG");
  const fbWarn = writer("WARN");
  const fbError = writer("ERROR");

  /**
   * Convert variadic overloads into a canonical (obj,msg,rest) triple.
   * Supported call patterns:
   *  - fn("msg")
   *  - fn("msg", {meta}, ...more)
   *  - fn({meta}, "msg", ...more)
   *  - fn({meta})
   *  - fn({meta1}, {meta2}, "msg")  // merged meta (rare, but we’ll be nice)
   */
  const toTriple = (args: unknown[]): [Json, string | undefined, unknown[]] => {
    if (args.length === 0) return [{}, undefined, []];

    const [a0, a1, ...rest] = args;

    // Case A: first arg is string message
    if (typeof a0 === "string") {
      const msg = a0 as string;
      // If second arg is a plain object, treat it as meta
      if (a1 && typeof a1 === "object" && !Array.isArray(a1)) {
        const meta = { ...(a1 as Json) };
        // Merge any additional plain objects in rest into meta
        const tail: unknown[] = [];
        for (const r of rest) {
          if (r && typeof r === "object" && !Array.isArray(r)) {
            Object.assign(meta, r as Json);
          } else {
            tail.push(r);
          }
        }
        return [meta, msg, tail];
      }
      // No meta object — pass through remaining args
      return [{}, msg, [a1, ...rest].filter((x) => x !== undefined)];
    }

    // Case B: first arg is an object (meta first)
    if (a0 && typeof a0 === "object" && !Array.isArray(a0)) {
      const meta = { ...(a0 as Json) };
      let msg: string | undefined = undefined;
      const tail: unknown[] = [];
      // If next arg is a string, that’s the message
      if (typeof a1 === "string") {
        msg = a1 as string;
        // Merge any additional plain objects from rest into meta
        for (const r of rest) {
          if (r && typeof r === "object" && !Array.isArray(r)) {
            Object.assign(meta, r as Json);
          } else {
            tail.push(r);
          }
        }
      } else {
        // No explicit message; merge all plain objects into meta
        for (const r of [a1, ...rest]) {
          if (r && typeof r === "object" && !Array.isArray(r)) {
            Object.assign(meta, r as Json);
          } else if (r !== undefined) {
            tail.push(r);
          }
        }
      }
      return [meta, msg, tail];
    }

    // Fallback: unknown shapes
    return [{ arg0: a0, arg1: a1 }, undefined, rest ?? []];
  };

  const fallback: ILogger = {
    edge: (...args: unknown[]) => {
      const [obj, msg, rest] = toTriple(args);
      fbEdge(obj, msg, ...rest);
    },
    info: (...args: unknown[]) => {
      const [obj, msg, rest] = toTriple(args);
      fbInfo(obj, msg, ...rest);
    },
    debug: (...args: unknown[]) => {
      const [obj, msg, rest] = toTriple(args);
      fbDebug(obj, msg, ...rest);
    },
    warn: (...args: unknown[]) => {
      const [obj, msg, rest] = toTriple(args);
      fbWarn(obj, msg, ...rest);
    },
    error: (...args: unknown[]) => {
      const [obj, msg, rest] = toTriple(args);
      fbError(obj, msg, ...rest);
    },
  };

  // If a root is provided, use it as-is; otherwise use fallback
  return {
    edge: logger.edge ?? fallback.edge,
    info: logger.info ?? fallback.info,
    debug: logger.debug ?? fallback.debug,
    warn: logger.warn ?? fallback.warn,
    error: logger.error ?? fallback.error,
  };
}

export function setRootLogger(logger: Partial<ILogger>): void {
  ROOT = normalizeRoot(logger);
}

export function getLogger(
  initialCtx: Record<string, unknown> = {}
): IBoundLogger {
  return new BoundLogger(initialCtx);
}

// ────────────────────────────────────────────────────────────────────────────
/**
 * BoundLogger uses arrow functions for public methods to **capture `this`**,
 * so calls like `const d = log.debug; d("msg")` remain safe.
 */
// ────────────────────────────────────────────────────────────────────────────

class BoundLogger implements IBoundLogger {
  constructor(private readonly ctx: Record<string, unknown> = {}) {}

  public bind(ctx: Record<string, unknown>): IBoundLogger {
    return new BoundLogger({ ...this.ctx, ...ctx });
  }

  private root(): ILogger {
    if (!ROOT) return normalizeRoot({});
    return ROOT;
  }

  private merge(bound: Json, obj?: Json): Json {
    return obj && typeof obj === "object" ? { ...bound, ...obj } : { ...bound };
  }

  // edge
  public edge = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const enabled =
      (process.env.LOG_EDGE_ENABLED ?? "true").toLowerCase() !== "false";
    if (!enabled) return;
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    if ((obj as any)["category"] == null) (obj as any).category = "edge";
    this.root().edge(obj, msg, ...tail);
  };

  // info
  public info = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    this.root().info(obj, msg, ...tail);
  };

  // warn
  public warn = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    this.root().warn(obj, msg, ...tail);
  };

  // error
  public error = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    this.root().error(obj, msg, ...tail);
  };

  // debug (adds origin)
  public debug = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const includeOrigin =
      (process.env.LOG_DEBUG_ORIGIN ?? "true").toLowerCase() !== "false";
    const [obj0, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    const obj = includeOrigin ? { ...obj0, origin: captureOrigin(2) } : obj0;
    this.root().debug(obj, msg, ...tail);
  };

  public serializeError(err: unknown) {
    if (err instanceof Error) {
      return { name: err.name, message: err.message, stack: err.stack };
    }

    return { message: String(err) };
  }
}

/** Normalize args for BoundLogger while merging in bound context. */
function normalizeForBound(
  boundCtx: Json,
  arg1: unknown,
  arg2?: unknown,
  rest: unknown[] = []
): [Json, string | undefined, unknown[]] {
  // Reuse the same logic as normalizeRoot’s toTriple, then merge ctx
  const [obj, msg, tail] = (function toTriple(
    args: unknown[]
  ): [Json, string | undefined, unknown[]] {
    if (args.length === 0) return [{}, undefined, []];
    const [a0, a1, ...r] = args;
    if (typeof a0 === "string") {
      const msg = a0 as string;
      if (a1 && typeof a1 === "object" && !Array.isArray(a1)) {
        const meta = { ...(a1 as Json) };
        const tail2: unknown[] = [];
        for (const x of r) {
          if (x && typeof x === "object" && !Array.isArray(x))
            Object.assign(meta, x as Json);
          else tail2.push(x);
        }
        return [meta, msg, tail2];
      }
      return [{}, msg, [a1, ...r].filter((x) => x !== undefined)];
    }
    if (a0 && typeof a0 === "object" && !Array.isArray(a0)) {
      const meta = { ...(a0 as Json) };
      let msg: string | undefined = undefined;
      const tail2: unknown[] = [];
      if (typeof a1 === "string") {
        msg = a1 as string;
        for (const x of r) {
          if (x && typeof x === "object" && !Array.isArray(x))
            Object.assign(meta, x as Json);
          else tail2.push(x);
        }
      } else {
        for (const x of [a1, ...r]) {
          if (x && typeof x === "object" && !Array.isArray(x))
            Object.assign(meta, x as Json);
          else if (x !== undefined) tail2.push(x);
        }
      }
      return [meta, msg, tail2];
    }
    return [{ arg0: a0, arg1: a1 }, undefined, r ?? []];
  })([arg1, arg2, ...rest]);

  return [{ ...boundCtx, ...obj }, msg, tail];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Capture file/method/line from the current stack frame.
 * depth=2 typically points at the caller of logger.debug().
 */
function captureOrigin(depth = 2): Record<string, string | number | undefined> {
  const e = new Error();
  const lines = (e.stack || "").split("\n");
  const line = lines[depth + 1] || "";
  const m =
    /at\s+(?<method>[^(\s]+)?\s*\(?((?<file>[^:()]+):(?<line>\d+):(?<col>\d+))\)?/i.exec(
      line
    );
  if (!m || !m.groups) return {};
  const fileFull = m.groups.file || "";
  const file = shortenPath(fileFull);
  const method = m.groups.method;
  const lineNum = Number(m.groups.line);
  return { file, method, line: lineNum };
}

/** Shorten absolute paths to repo-relative where possible (heuristic). */
function shortenPath(abs: string): string {
  const anchors = ["/backend/", "/src/"];
  for (const a of anchors) {
    const i = abs.indexOf(a);
    if (i >= 0) return abs.slice(i + 1);
  }
  return abs;
}
