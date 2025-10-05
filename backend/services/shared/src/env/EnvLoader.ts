// backend/services/shared/src/env/EnvLoader.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Deterministic env loading for the monorepo.
 *
 * Policy (updated):
 * - Load order & precedence:
 *   1) REPO ROOT: .env, .env.<mode>         (base)
 *   2) SERVICE-LOCAL: .env, .env.<mode>     (OVERRIDES root)
 *   3) ENV_FILE (if provided)               (OVERRIDES root & service)
 *
 * - No silent defaults. Use requireEnv()/requireNumber() for hard requirements.
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

  /** Fail-fast accessor for required env variables. */
  static requireEnv(name: string): string {
    const v = process.env[name];
    if (!v || !String(v).trim()) {
      throw new Error(`${name} is required but not set`);
    }
    return v;
  }

  /** Convenience for numeric envs with error messages that name the key. */
  static requireNumber(name: string): number {
    const raw = this.requireEnv(name);
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(`${name} must be a finite number`);
    }
    return n;
  }
}

export default EnvLoader;
