// backend/services/shared/src/env/EnvLoader.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: see env loading notes in the Bootstrap ADR when added
 *
 * Purpose:
 * - Deterministic, fail-safe environment loading for a monorepo.
 *
 * Design:
 * - Detect the true repo root (presence of .git or pnpm-workspace.yaml).
 * - Load repo-root envs first (.env, then .env.<mode>), then service-local
 *   (.env, then .env.<mode>) WITHOUT override — root wins for shared keys.
 * - Respect ENV_FILE when provided (absolute or repo-root relative).
 * - Never silently ignore missing required keys — expose requireEnv().
 *
 * Notes:
 * - We intentionally avoid dotenv override on local files so a service cannot
 *   accidentally clobber shared, cross-service configuration like
 *   SVCFACILITATOR_BASE_URL.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

export type EnvMode = "dev" | "test" | "docker" | "production" | string;

class EnvLoaderClass {
  /** Locate repo root by walking up from a starting directory. */
  static findRepoRoot(startDir: string = process.cwd()): string {
    let dir = startDir;
    const fsRoot = path.parse(dir).root;

    while (true) {
      const hasGit = fs.existsSync(path.join(dir, ".git"));
      const hasWorkspace = fs.existsSync(path.join(dir, "pnpm-workspace.yaml"));
      const hasRootPkg = fs.existsSync(path.join(dir, "package.json"));

      if (hasGit || hasWorkspace || hasRootPkg) return dir;

      const parent = path.dirname(dir);
      if (parent === dir || parent === fsRoot) break;
      dir = parent;
    }

    // Fall back: best guess = current startDir
    return startDir;
  }

  /**
   * Load env files in a safe order:
   * 1) If ENV_FILE is set: load that first (absolute or repo-root relative).
   * 2) Load repo-root .env, then .env.<mode>
   * 3) Load service-local .env, then .env.<mode>
   * Local loads DO NOT override existing keys to preserve shared config.
   */
  static loadAll(options?: { mode?: EnvMode; cwd?: string }): void {
    const cwd = options?.cwd ?? process.cwd();
    const repoRoot = this.findRepoRoot(cwd);
    const mode = (process.env.MODE ??
      process.env.NODE_ENV ??
      options?.mode ??
      "dev") as EnvMode;

    // 1) Explicit ENV_FILE from runner (absolute or repo-root relative)
    const envFileFromRunner = process.env.ENV_FILE;
    if (envFileFromRunner) {
      const pathResolved = path.isAbsolute(envFileFromRunner)
        ? envFileFromRunner
        : path.join(repoRoot, envFileFromRunner);
      if (fs.existsSync(pathResolved)) {
        dotenv.config({ path: pathResolved });
      }
    }

    // Helper to load if exists with a chosen override flag.
    const loadIf = (p: string, override = false) => {
      if (fs.existsSync(p)) dotenv.config({ path: p, override });
    };

    // 2) Repo-root first (root wins)
    loadIf(path.join(repoRoot, ".env"));
    loadIf(path.join(repoRoot, `.env.${mode}`));

    // 3) Service-local without override (do not clobber root)
    loadIf(path.join(cwd, ".env"), /*override*/ false);
    loadIf(path.join(cwd, `.env.${mode}`), /*override*/ false);
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

// Export in both shapes so existing imports don't break.
const EnvLoader = EnvLoaderClass;
export { EnvLoader };
export default EnvLoader;
