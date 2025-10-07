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
 *     log.info("msg")  OR  log.info({ctx}, "msg")
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

  // Display tag per requirement
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

  // Helpers to convert overload calls into (obj,msg,rest)
  const toPair = (
    arg1: unknown,
    arg2?: unknown
  ): [Json, string | undefined, unknown[]] => {
    if (typeof arg1 === "string") return [{}, arg1, []];
    return [
      (arg1 as Json) ?? {},
      typeof arg2 === "string" ? arg2 : undefined,
      [],
    ];
  };

  const fallback = {
    edge: (...args: unknown[]) => {
      const [obj, msg] = toPair(args[0], args[1]);
      fbEdge(obj, msg, ...args.slice(2));
    },
    info: (...args: unknown[]) => {
      const [obj, msg] = toPair(args[0], args[1]);
      fbInfo(obj, msg, ...args.slice(2));
    },
    debug: (...args: unknown[]) => {
      const [obj, msg] = toPair(args[0], args[1]);
      fbDebug(obj, msg, ...args.slice(2));
    },
    warn: (...args: unknown[]) => {
      const [obj, msg] = toPair(args[0], args[1]);
      fbWarn(obj, msg, ...args.slice(2));
    },
    error: (...args: unknown[]) => {
      const [obj, msg] = toPair(args[0], args[1]);
      fbError(obj, msg, ...args.slice(2));
    },
  } as ILogger;

  // If a root is provided, use it as-is (it may be pino/etc. with its own formatting).
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
    const [obj, msg] =
      typeof arg1 === "string"
        ? [{}, arg1]
        : [arg1 as Json, arg2 as string | undefined];
    const payload = this.merge(this.ctx, obj);
    if ((payload as any)["category"] == null)
      (payload as any).category = "edge";
    this.root().edge(payload, msg, ...rest);
  };

  // info
  public info = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg] =
      typeof arg1 === "string"
        ? [{}, arg1]
        : [arg1 as Json, arg2 as string | undefined];
    this.root().info(this.merge(this.ctx, obj), msg, ...rest);
  };

  // warn
  public warn = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg] =
      typeof arg1 === "string"
        ? [{}, arg1]
        : [arg1 as Json, arg2 as string | undefined];
    this.root().warn(this.merge(this.ctx, obj), msg, ...rest);
  };

  // error
  public error = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg] =
      typeof arg1 === "string"
        ? [{}, arg1]
        : [arg1 as Json, arg2 as string | undefined];
    this.root().error(this.merge(this.ctx, obj), msg, ...rest);
  };

  // debug (adds origin)
  public debug = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const includeOrigin =
      (process.env.LOG_DEBUG_ORIGIN ?? "true").toLowerCase() !== "false";
    const [obj, msg] =
      typeof arg1 === "string"
        ? [{}, arg1]
        : [arg1 as Json, arg2 as string | undefined];
    const base = this.merge(this.ctx, obj);
    const payload = includeOrigin
      ? { ...base, origin: captureOrigin(2) }
      : base;
    this.root().debug(payload, msg, ...rest);
  };
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
