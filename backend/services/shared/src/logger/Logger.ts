// backend/services/shared/src/logger/Logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0016 (Logging Architecture & Runtime Config)
 *   - ADR-0018 (Debug Log Origin Capture)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Single shared logging API for all services with contextual .bind().
 * - Overloaded methods allow:
 *     log.info("msg")            OR  log.info({ctx}, "msg")
 *     log.info("msg", {meta})    OR  log.info({meta}, "msg")
 * - debug() adds origin capture (file/method/line).
 * - PROMPT is a first-class level for prompt/prompt-catalog events.
 *
 * Runtime Controls (strict, via SvcEnvDto only):
 * - LOG_LEVEL = debug | info | warn | error   (REQUIRED — no defaults)
 *
 * Notes:
 * - Edge channel and debug-origin are always enabled (no flags, greenfield).
 * - PROMPT logs are gated like WARN (suppressed only when LOG_LEVEL=error).
 * - No process.env usage anywhere; fail-fast if SvcEnv not set.
 */

type Json = Record<string, unknown>;

/** Canonical logger contract — edge() is first class, not optional. */
export interface ILogger {
  edge(msg: string, ...rest: unknown[]): void;
  edge(obj: Json, msg?: string, ...rest: unknown[]): void;

  info(msg: string, ...rest: unknown[]): void;
  info(obj: Json, msg?: string, ...rest: unknown[]): void;

  debug(msg: string, ...rest: unknown[]): void;
  debug(obj: Json, msg?: string, ...rest: unknown[]): void;

  /**
   * PROMPT: used for prompt-catalog / localization issues (e.g., missing prompts).
   * Sits between INFO and WARN in seriousness, but is its own channel.
   */
  prompt(msg: string, ...rest: unknown[]): void;
  prompt(obj: Json, msg?: string, ...rest: unknown[]): void;

  warn(msg: string, ...rest: unknown[]): void;
  warn(obj: Json, msg?: string, ...rest: unknown[]): void;

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

  /**
   * PROMPT: first-class level for prompt/prompt-catalog events.
   */
  prompt(msg: string, ...rest: unknown[]): void;
  prompt(obj: Json, msg?: string, ...rest: unknown[]): void;

  warn(msg: string, ...rest: unknown[]): void;
  warn(obj: Json, msg?: string, ...rest: unknown[]): void;

  error(msg: string, ...rest: unknown[]): void;
  error(obj: Json, msg?: string, ...rest: unknown[]): void;

  serializeError(err: unknown): {
    name?: string;
    message: string;
    stack?: string;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Root logger + strict env source (SvcEnvDto)
// ────────────────────────────────────────────────────────────────────────────

let ROOT: ILogger | null = null;

// Strict SvcEnv binding (no fallbacks, required)
type SvcEnvLike = { getEnvVar: (k: string) => string };
let SVCENV: SvcEnvLike | null = null;

/** Must be called once early (e.g., AppBase after env resolved). */
export function setLoggerEnv(env: SvcEnvLike): void {
  if (!env || typeof env.getEnvVar !== "function") {
    throw new Error(
      "Logger: setLoggerEnv requires a SvcEnvDto-like object with getEnvVar()."
    );
  }
  SVCENV = env;
}

function getEnvStrict(key: string): string {
  if (!SVCENV) {
    throw new Error(
      `Logger: SvcEnv not set. Call setLoggerEnv(...) before using the logger (missing key: ${key}).`
    );
  }
  const v = SVCENV.getEnvVar(key); // will throw if missing — desired
  if (v == null || `${v}`.trim() === "") {
    throw new Error(`Logger: required env "${key}" is empty.`);
  }
  return `${v}`;
}

/** Local-time timestamp "YYYY-MM-DD HH:mm:ss". */
function tsLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Create a prefixed console writer for a given level tag. */
function writer(tag: "EDGE" | "INFO" | "DEBUG" | "WARN" | "ERROR" | "PROMPT") {
  const c =
    tag === "ERROR"
      ? console.error
      : tag === "WARN"
      ? console.warn
      : tag === "DEBUG"
      ? console.debug
      : console.log;

  const displayTag =
    tag === "ERROR"
      ? "***ERROR***"
      : tag === "WARN"
      ? "**WARN"
      : tag === "PROMPT"
      ? "PROMPT"
      : tag;

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
  const fbPrompt = writer("PROMPT");
  const fbWarn = writer("WARN");
  const fbError = writer("ERROR");

  const toTriple = (args: unknown[]): [Json, string | undefined, unknown[]] => {
    if (args.length === 0) return [{}, undefined, []];
    const [a0, a1, ...rest] = args;

    if (typeof a0 === "string") {
      const msg = a0 as string;
      if (a1 && typeof a1 === "object" && !Array.isArray(a1)) {
        const meta = { ...(a1 as Json) };
        const tail: unknown[] = [];
        for (const r of rest) {
          if (r && typeof r === "object" && !Array.isArray(r))
            Object.assign(meta, r as Json);
          else tail.push(r);
        }
        return [meta, msg, tail];
      }
      return [{}, msg, [a1, ...rest].filter((x) => x !== undefined)];
    }

    if (a0 && typeof a0 === "object" && !Array.isArray(a0)) {
      const meta = { ...(a0 as Json) };
      let msg: string | undefined = undefined;
      const tail: unknown[] = [];
      if (typeof a1 === "string") {
        msg = a1 as string;
        for (const r of rest) {
          if (r && typeof r === "object" && !Array.isArray(r))
            Object.assign(meta, r as Json);
          else tail.push(r);
        }
      } else {
        for (const r of [a1, ...rest]) {
          if (r && typeof r === "object" && !Array.isArray(r))
            Object.assign(meta, r as Json);
          else if (r !== undefined) tail.push(r);
        }
      }
      return [meta, msg, tail];
    }

    return [{ arg0: a0, arg1: a1 }, undefined, rest ?? []];
  };

  const fallback: ILogger = {
    edge: (...args: unknown[]) => {
      const [o, m, t] = toTriple(args);
      fbEdge(o, m, ...t);
    },
    info: (...args: unknown[]) => {
      const [o, m, t] = toTriple(args);
      fbInfo(o, m, ...t);
    },
    debug: (...args: unknown[]) => {
      const [o, m, t] = toTriple(args);
      fbDebug(o, m, ...t);
    },
    prompt: (...args: unknown[]) => {
      const [o, m, t] = toTriple(args);
      fbPrompt(o, m, ...t);
    },
    warn: (...args: unknown[]) => {
      const [o, m, t] = toTriple(args);
      fbWarn(o, m, ...t);
    },
    error: (...args: unknown[]) => {
      const [o, m, t] = toTriple(args);
      fbError(o, m, ...t);
    },
  };

  return {
    edge: logger.edge ?? fallback.edge,
    info: logger.info ?? fallback.info,
    debug: logger.debug ?? fallback.debug,
    prompt: logger.prompt ?? fallback.prompt,
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
// Level evaluation (strict) — from SvcEnv only
// ────────────────────────────────────────────────────────────────────────────

type LevelName = "debug" | "info" | "warn" | "error";
const LEVEL_ORDER: Record<LevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevelStrict(): LevelName {
  const raw = getEnvStrict("LOG_LEVEL").toLowerCase().trim();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error")
    return raw;
  throw new Error(
    `Logger: invalid LOG_LEVEL="${raw}". Use one of debug|info|warn|error.`
  );
}

function levelAllows(target: LevelName): boolean {
  const current = parseLevelStrict();
  return LEVEL_ORDER[target] >= LEVEL_ORDER[current];
}

// ────────────────────────────────────────────────────────────────────────────
// Bound logger
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

  // edge (always enabled)
  public edge = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    if ((obj as any)["category"] == null) (obj as any).category = "edge";
    this.root().edge(obj, msg, ...tail);
  };

  // info (honors strict LOG_LEVEL)
  public info = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    if (!levelAllows("info")) return;
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    this.root().info(obj, msg, ...tail);
  };

  // debug (honors strict LOG_LEVEL; always includes origin)
  public debug = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    if (!levelAllows("debug")) return;
    const [obj0, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    const obj = { ...obj0, origin: captureOrigin(2) };
    this.root().debug(obj, msg, ...tail);
  };

  // PROMPT (honors LOG_LEVEL like WARN; suppressed only when LOG_LEVEL=error)
  public prompt = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    if (!levelAllows("warn")) return;
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    if ((obj as any)["category"] == null) (obj as any).category = "prompt";
    this.root().prompt(obj, msg, ...tail);
  };

  // warn (honors strict LOG_LEVEL)
  public warn = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    if (!levelAllows("warn")) return;
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    this.root().warn(obj, msg, ...tail);
  };

  // error (always logs)
  public error = (arg1: unknown, arg2?: unknown, ...rest: unknown[]): void => {
    const [obj, msg, tail] = normalizeForBound(this.ctx, arg1, arg2, rest);
    this.root().error(obj, msg, ...tail);
  };

  public serializeError(err: unknown) {
    if (err instanceof Error)
      return { name: err.name, message: err.message, stack: err.stack };
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

/** Capture file/method/line from the current stack frame. */
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
