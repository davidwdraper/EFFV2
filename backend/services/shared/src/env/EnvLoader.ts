// backend/services/shared/src/env/EnvLoader.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Deterministic env loading for the monorepo.
 * - Strict, typed accessors (presence + coercion + clear operator errors).
 *
 * Policy (updated):
 * - Load order & precedence:
 *   1) REPO ROOT: .env, .env.<mode>         (base)
 *   2) SERVICE-LOCAL: .env, .env.<mode>     (OVERRIDES root)
 *   3) ENV_FILE (if provided)               (OVERRIDES root & service)
 *
 * - No silent defaults. Dev == Prod: fail-fast on missing/invalid values.
 * - Debug summary lists files, applied keys, and how many were overrides.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

export type EnvMode = "dev" | "test" | "docker" | "production" | string;

function safeRead(file: string): Record<string, string> {
  try {
    const buf = fs.readFileSync(file, "utf8");
    return dotenv.parse(buf);
  } catch {
    return {};
  }
}

/** Uppercase-with-underscores guard; we don’t set weird keys. */
const VALID_KEY = /^[A-Z0-9_]+$/;

type ApplyStats = {
  file: string;
  newKeys: number;
  overrides: number;
  totalKeys: number;
};

function applyEnvFromFile(file: string, override: boolean): ApplyStats {
  const kv = safeRead(file);
  let newKeys = 0;
  let overrides = 0;
  for (const [k, v] of Object.entries(kv)) {
    if (!VALID_KEY.test(k)) continue;
    const existed = Object.prototype.hasOwnProperty.call(process.env, k);
    if (!existed) {
      process.env[k] = v;
      newKeys++;
    } else if (override && process.env[k] !== v) {
      process.env[k] = v;
      overrides++;
    }
  }
  return { file, newKeys, overrides, totalKeys: Object.keys(kv).length };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Strict, typed accessors
 * ──────────────────────────────────────────────────────────────────────────── */

function raw(name: string): string {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") {
    throw new Error(`ENV: ${name} is required but was not provided.`);
  }
  return String(v).trim();
}

function toAbsPath(name: string, v: string): string {
  if (!path.isAbsolute(v)) {
    throw new Error(`ENV: ${name} must be an absolute path (got: "${v}").`);
  }
  return v;
}

function toInt(
  name: string,
  v: string,
  opts?: { min?: number; max?: number }
): number {
  const n = Number(v);
  if (!Number.isInteger(n)) {
    throw new Error(`ENV: ${name} must be an integer (got: "${v}").`);
  }
  if (opts?.min != null && n < opts.min) {
    throw new Error(`ENV: ${name} must be >= ${opts.min} (got: ${n}).`);
  }
  if (opts?.max != null && n > opts.max) {
    throw new Error(`ENV: ${name} must be <= ${opts.max} (got: ${n}).`);
  }
  return n;
}

function toNumber(
  name: string,
  v: string,
  opts?: { min?: number; max?: number; allowNaN?: boolean }
): number {
  const n = Number(v);
  if (!opts?.allowNaN && Number.isNaN(n)) {
    throw new Error(`ENV: ${name} must be a number (got: "${v}").`);
  }
  if (opts?.min != null && n < opts.min) {
    throw new Error(`ENV: ${name} must be >= ${opts.min} (got: ${n}).`);
  }
  if (opts?.max != null && n > opts.max) {
    throw new Error(`ENV: ${name} must be <= ${opts.max} (got: ${n}).`);
  }
  return n;
}

function toBool(name: string, v: string): boolean {
  const s = v.toLowerCase();
  if (["1", "true", "on", "yes"].includes(s)) return true;
  if (["0", "false", "off", "no"].includes(s)) return false;
  throw new Error(
    `ENV: ${name} must be boolean-like (true/false/on/off/1/0) (got: "${v}").`
  );
}

function toServiceIdent(
  name: string,
  v: string
): { slug: string; version: number } {
  // e.g., "audit@1", "user@2"; slug allows lowercase letters, digits, dashes.
  const m = /^([a-z][a-z0-9-]*)@(\d+)$/.exec(v);
  if (!m) {
    throw new Error(
      `ENV: ${name} must be in the form "<slug>@<version>", e.g. "audit@1" (got: "${v}").`
    );
  }
  const slug = m[1];
  const version = Number(m[2]);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `ENV: ${name} version must be an integer >= 1 (got: "${m[2]}").`
    );
  }
  return { slug, version };
}

export class EnvLoader {
  /** Locate repo root by walking up from a starting directory. */
  static findRepoRoot(startDir: string = process.cwd()): string {
    let dir = startDir;
    const fsRoot = path.parse(dir).root;

    while (true) {
      const hasGit = fs.existsSync(path.join(dir, ".git"));
      const hasWorkspace = fs.existsSync(path.join(dir, "pnpm-workspace.yaml"));
      if (hasGit || hasWorkspace) return dir;
      const parent = path.dirname(dir);
      if (parent === dir || parent === fsRoot) break;
      dir = parent;
    }

    // Soft fallback: nearest package.json with workspaces
    dir = startDir;
    while (true) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
          if (pkg && (pkg.workspaces || pkg.packages)) return dir;
        } catch {
          /* ignore */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir || parent === fsRoot) break;
      dir = parent;
    }

    return startDir;
  }

  /**
   * Load env files in a safe, deterministic order.
   * Root first (base), then service (overrides), then ENV_FILE (final overrides).
   */
  static loadAll(options?: {
    mode?: EnvMode;
    cwd?: string;
    debugLogger?: (msg: string) => void;
  }): void {
    const log = options?.debugLogger ?? (() => {});
    const serviceCwd = options?.cwd ?? process.cwd();
    const repoRoot = this.findRepoRoot(serviceCwd);

    const resolvedMode = (
      process.env.MODE ??
      process.env.NODE_ENV ??
      options?.mode ??
      "dev"
    )
      .toString()
      .toLowerCase() as EnvMode;

    // Build candidates in groups: [files, overrideFlag]
    const groups: Array<{ files: string[]; override: boolean }> = [
      {
        files: [
          path.join(repoRoot, ".env"),
          path.join(repoRoot, `.env.${resolvedMode}`),
        ],
        override: false,
      }, // base
      {
        files: [
          path.join(serviceCwd, ".env"),
          path.join(serviceCwd, `.env.${resolvedMode}`),
        ],
        override: true,
      }, // service overrides
    ];

    // ENV_FILE (if present) is final, overriding everything
    const envFileFromRunner = process.env.ENV_FILE;
    if (envFileFromRunner) {
      const explicit = path.isAbsolute(envFileFromRunner)
        ? envFileFromRunner
        : path.join(repoRoot, envFileFromRunner);
      groups.push({ files: [explicit], override: true });
    }

    // Deduplicate existing files while preserving order
    const seen = new Set<string>();
    const summaries: ApplyStats[] = [];
    for (const group of groups) {
      for (const f of group.files) {
        const abs = path.resolve(f);
        if (!fs.existsSync(abs)) continue;
        if (seen.has(abs)) continue;
        seen.add(abs);
        const s = applyEnvFromFile(abs, group.override);
        summaries.push(s);
      }
    }

    // Debug summary
    try {
      const parts = summaries.map((s) => {
        const rel = path.relative(repoRoot, s.file) || s.file;
        return `${rel}:${s.newKeys}+${s.overrides}/${s.totalKeys}`;
      });
      log(`[env] loaded_files=${summaries.length} ${parts.join(" ")}`);
    } catch {
      /* no-op */
    }
  }

  // Back-compat (kept)
  static requireEnv(name: string): string {
    return raw(name);
  }
  static requireNumber(name: string): number {
    return toNumber(name, raw(name));
  }

  // Preferred strict accessors
  static reqString(
    name: string,
    opts?: { allowed?: string[]; pattern?: RegExp }
  ): string {
    const v = raw(name);
    if (opts?.allowed && !opts.allowed.includes(v)) {
      throw new Error(
        `ENV: ${name} must be one of [${opts.allowed.join(
          ", "
        )}] (got: "${v}").`
      );
    }
    if (opts?.pattern && !opts.pattern.test(v)) {
      throw new Error(
        `ENV: ${name} does not match required pattern ${opts.pattern} (got: "${v}").`
      );
    }
    return v;
  }

  static reqInt(name: string, opts?: { min?: number; max?: number }): number {
    return toInt(name, raw(name), opts);
  }

  static reqNumber(
    name: string,
    opts?: { min?: number; max?: number; allowNaN?: boolean }
  ): number {
    return toNumber(name, raw(name), opts);
  }

  static reqBool(name: string): boolean {
    return toBool(name, raw(name));
  }

  static reqAbsPath(name: string): string {
    return toAbsPath(name, raw(name));
  }

  /** NEW: parse "<slug>@<version>" into typed parts, e.g., "audit@1" → { slug:"audit", version:1 } */
  static reqServiceIdent(name: string): { slug: string; version: number } {
    return toServiceIdent(name, raw(name));
  }

  // Optionals (validate if present)
  static optString(
    name: string,
    opts?: { allowed?: string[]; pattern?: RegExp }
  ): string | undefined {
    const v = process.env[name];
    if (v == null || String(v).trim() === "") return undefined;
    return this.reqString(name, opts);
  }
  static optInt(
    name: string,
    opts?: { min?: number; max?: number }
  ): number | undefined {
    const v = process.env[name];
    if (v == null || String(v).trim() === "") return undefined;
    return this.reqInt(name, opts);
  }
  static optNumber(
    name: string,
    opts?: { min?: number; max?: number; allowNaN?: boolean }
  ): number | undefined {
    const v = process.env[name];
    if (v == null || String(v).trim() === "") return undefined;
    return this.reqNumber(name, opts);
  }
  static optBool(name: string): boolean | undefined {
    const v = process.env[name];
    if (v == null || String(v).trim() === "") return undefined;
    return this.reqBool(name);
  }
  static optAbsPath(name: string): string | undefined {
    const v = process.env[name];
    if (v == null || String(v).trim() === "") return undefined;
    return this.reqAbsPath(name);
  }
}

export default EnvLoader;
