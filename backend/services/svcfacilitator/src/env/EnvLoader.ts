// backend/services/shared/src/env/EnvLoader.ts
/**
 * EnvLoader — universal root→service .env layering (transparent for all services).
 *
 * Load order (later overrides earlier):
 *   1) <repoRoot>/.env
 *   2) <repoRoot>/.env.dev
 *   3) <serviceRoot>/.env
 *   4) <serviceRoot>/.env.dev
 *
 * Design notes:
 * - We derive serviceRoot from process.cwd(). Your run.sh starts each service
 *   with its working directory set to that service folder—so this is stable.
 * - We derive repoRoot by walking upward until we see a package.json or .git.
 * - Idempotent: safe to run more than once; dotenv “override” used only for *.dev.
 */

import { existsSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { config as loadEnv } from "dotenv";

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function looksLikeRepoRoot(p: string): boolean {
  return existsSync(join(p, "package.json")) || isDir(join(p, ".git"));
}
function findRepoRoot(start: string): string {
  let cur = resolve(start);
  for (let i = 0; i < 12; i++) {
    // safety bound
    if (looksLikeRepoRoot(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // Fallback: assume start’s parent is the repo root
  return dirname(start);
}

export function loadLayeredEnvFromCwd(): {
  repoRoot: string;
  serviceRoot: string;
  loaded: string[];
} {
  const serviceRoot = resolve(process.cwd()); // run.sh sets CWD to the service folder
  const repoRoot = findRepoRoot(serviceRoot);
  const loaded: string[] = [];

  const tryLoad = (p: string, override = false) => {
    if (existsSync(p)) {
      loadEnv({ path: p, override });
      loaded.push(p);
    }
  };

  // Root first (baseline for all services)
  tryLoad(join(repoRoot, ".env"));
  tryLoad(join(repoRoot, ".env.dev"), true);

  // Then service-local (overrides)
  tryLoad(join(serviceRoot, ".env"));
  tryLoad(join(serviceRoot, ".env.dev"), true);

  return { repoRoot, serviceRoot, loaded };
}
