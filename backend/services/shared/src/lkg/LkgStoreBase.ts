// backend/services/shared/src/lkg/LkgStoreBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Generic, reusable Last-Known-Good (LKG) file helper to avoid copy/paste plumbing.
 * - Handles path resolution (env/default), atomic writes, and JSON load/parse.
 * - No console.* — uses shared Logger.
 *
 * Use-cases:
 * - Gateway svcconfig mirror
 * - svcfacilitator mirror
 * - Any other service-local cache that needs an LKG fallback
 *
 * Design:
 * - JSON snapshot format is intentionally generic:
 *     Without wrapKey:
 *       { "savedAt": "<ISO>", "data": <T>, ...meta }
 *     With wrapKey: (e.g., wrapKey="mirror")
 *       { "savedAt": "<ISO>", "<wrapKey>": <T>, ...meta }
 *
 * Validation:
 * - Optional `normalize` converts unknown input into T (e.g., via class/contract).
 * - Optional `validate` throws if T is unacceptable (shape/keys).
 *
 * Notes:
 * - Paths may be absolute or repo-root relative (via EnvLoader.findRepoRoot()).
 * - Reads/writes are sync for simplicity & early-boot reliability.
 */

import fs from "fs";
import path from "path";
import { EnvLoader } from "../env/EnvLoader";
import { getLogger } from "../util/logger.provider";

export type LkgNormalizeFn<T> = (input: unknown) => T;
export type LkgValidateFn<T> = (data: T) => void;

export type LkgStoreOptions<T> = {
  /** Environment variable name that holds the file path (e.g., SVCCONFIG_LKG_PATH). */
  envVarName?: string;
  /** Default file path used when env var is absent. */
  defaultPath?: string;
  /** When set, snapshot stores/loads `data` under this key instead of "data". */
  wrapKey?: string; // e.g., "mirror"
  /** Optional normalizer to coerce unknown JSON into T. */
  normalize?: LkgNormalizeFn<T>;
  /** Optional validator to assert business invariants. */
  validate?: LkgValidateFn<T>;
  /** Logger binding context (slug + version recommended). */
  logCtx: { slug: string; version?: number; url?: string };
};

export class LkgStoreBase<T extends object = Record<string, unknown>> {
  private readonly envVarName?: string;
  private readonly defaultPath?: string;
  private readonly wrapKey?: string;
  private readonly normalize?: LkgNormalizeFn<T>;
  private readonly validate?: LkgValidateFn<T>;
  private readonly log = getLogger().bind({
    slug: "shared",
    version: 1,
    url: "/lkg",
  });
  private readonly boundLog = getLogger().bind({
    slug: "shared",
    version: 1,
    url: "/lkg",
  });

  constructor(opts: LkgStoreOptions<T>) {
    this.envVarName = opts.envVarName;
    this.defaultPath = opts.defaultPath;
    this.wrapKey = opts.wrapKey;
    this.normalize = opts.normalize;
    this.validate = opts.validate;

    // Use provided logging context, fallback to generic shared/lkg
    const ctx = {
      slug: opts.logCtx.slug,
      version: opts.logCtx.version ?? 1,
      url: opts.logCtx.url ?? "/lkg",
    };
    (this as any).log = getLogger().bind(ctx);
    (this as any).boundLog = (this as any).log; // alias for clarity in code below
  }

  /** Resolve absolute file path or null if neither env nor default configured. */
  public resolvePath(cwd: string = process.cwd()): string | null {
    const fromEnv = this.envVarName
      ? (process.env[this.envVarName] || "").trim()
      : "";
    const p = fromEnv || this.defaultPath || "";
    if (!p) return null;

    // Resolve relative to repo root for stability
    const repoRoot = EnvLoader.findRepoRoot?.(cwd) ?? cwd;
    return path.isAbsolute(p) ? p : path.join(repoRoot, p);
  }

  /** True if configured path exists. */
  public exists(): boolean {
    const p = this.resolvePath();
    return !!(p && fs.existsSync(p));
  }

  /** Load & parse snapshot; throws if not configured or unreadable/invalid. */
  public load(): T {
    const p = this.ensureConfiguredPath();

    if (!fs.existsSync(p)) {
      throw new Error(`LKG missing: ${p}`);
    }

    const raw = fs.readFileSync(p, "utf8");
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`LKG parse error (invalid JSON): ${p}`);
    }

    const payload = this.extractPayload(parsed);
    const data = this.normalize ? this.normalize(payload) : (payload as T);

    if (this.validate) this.validate(data);

    this.boundLog.info(`lkg_load_success - path=${p}`);
    return data;
  }

  /** Try to load & parse snapshot; returns null on any failure (no throw). */
  public tryLoad(): T | null {
    try {
      return this.load();
    } catch (e) {
      this.boundLog.warn(`lkg_load_failed - ${String(e)}`);
      return null;
    }
  }

  /**
   * Persist a snapshot atomically. Adds `savedAt`, and stores under `wrapKey`
   * when provided, otherwise under `data`.
   */
  public save(data: T, meta?: Record<string, unknown>): void {
    const p = this.resolvePath();
    if (!p) {
      this.boundLog.warn("lkg_save_skipped - no path configured");
      return;
    }

    try {
      const dir = path.dirname(p);
      fs.mkdirSync(dir, { recursive: true });

      const snapshot = this.buildSnapshot(data, meta);
      const tmp = `${p}.${Date.now()}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(tmp, p);

      // Best-effort directory fsync
      try {
        const fd = fs.openSync(dir, "r");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }

      this.boundLog.info(`lkg_save_success - path=${p}`);
    } catch (e) {
      this.boundLog.warn(`lkg_save_failed - ${String(e)}`);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private ensureConfiguredPath(): string {
    const p = this.resolvePath();
    if (!p) {
      throw new Error(
        `LKG path not configured${
          this.envVarName
            ? ` (set ${this.envVarName} or provide defaultPath)`
            : ""
        }`
      );
    }
    return p;
  }

  private extractPayload(parsed: any): unknown {
    if (this.wrapKey) {
      const v = parsed?.[this.wrapKey];
      if (v == null || typeof parsed !== "object") {
        throw new Error(
          `LKG invalid: expected object with "${this.wrapKey}" key`
        );
      }
      return v;
    }
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) {
      throw new Error('LKG invalid: expected object with "data" key');
    }
    return parsed.data;
  }

  private buildSnapshot(
    data: T,
    meta?: Record<string, unknown>
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      savedAt: new Date().toISOString(),
      ...(meta ?? {}),
    };
    if (this.wrapKey) {
      base[this.wrapKey] = data;
    } else {
      base.data = data;
    }
    return base;
  }
}
