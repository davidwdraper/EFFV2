// backend/services/shared/src/env.ts

/**
 * Docs:
 * - Design: docs/design/backend/config/env-loading.md
 * - Architecture: docs/architecture/backend/CONFIG.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Deterministic environment loading for every service with strict precedence:
 *   repo root → service family → service root. Later wins.
 * - Per NODE_ENV, try these at each layer:
 *   dev:    env.dev → .env.dev → .env
 *   docker: env.docker → .env.docker → .env
 *   prod:   .env (optional; prefer injected env)
 *
 * Notes:
 * - Only env cascade + validators live here. Boot policy is in shared bootstrap.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";

/** Find the repo root by walking up until we see .git or pnpm-workspace.yaml. */
function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  let lastHit: string | null = null;
  for (;;) {
    const hasGit = fs.existsSync(path.join(dir, ".git"));
    const hasWs = fs.existsSync(path.join(dir, "pnpm-workspace.yaml"));
    if (hasGit || hasWs) lastHit = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return lastHit ?? path.resolve(start, "..", ".."); // last-ditch: two levels up
}

/** Load a single env file if it exists; expand; return true if loaded. */
function loadIfExists(absPath: string): boolean {
  if (!fs.existsSync(absPath)) return false;
  const parsed = dotenv.config({ path: absPath });
  if (parsed.error)
    throw new Error(
      `Failed to load env file: ${absPath} — ${String(parsed.error)}`
    );
  dotenvExpand.expand(parsed);
  return true;
}

/** Load several files in order; later files override earlier ones. Throws if none loaded and allowMissing=false. */
export function loadEnvFilesOrThrow(
  files: string[],
  opts: { allowMissing?: boolean } = {}
) {
  let loadedAny = false;
  for (const f of files) loadedAny = loadIfExists(path.resolve(f)) || loadedAny;
  if (!loadedAny && !opts.allowMissing)
    throw new Error(`No env files loaded from: ${files.join(", ")}`);
}

/**
 * Cascading loader for a service.
 * Layers: repoRoot → serviceFamilyDir → serviceRoot
 * Files tried per layer depend on NODE_ENV:
 *   dev:    ["env.dev", ".env.dev", ".env"]
 *   docker: ["env.docker", ".env.docker", ".env"]
 *   prod:   [".env"]  (optional)
 */
export function loadEnvCascadeForService(
  serviceRootAbs: string,
  opts: { allowMissingInProd?: boolean } = {}
) {
  const mode = (process.env.NODE_ENV || "").trim();
  if (!mode)
    throw new Error("NODE_ENV is required (dev | docker | production).");

  // Accept any path inside the service (service root or src). Normalize:
  const servicePath = path.resolve(serviceRootAbs);
  // service root = directory that contains the service; family = its parent
  const serviceRoot = fs.existsSync(path.join(servicePath, "src"))
    ? servicePath
    : path.dirname(servicePath);
  const familyDir = path.resolve(serviceRoot, "..");
  const repoRoot = findRepoRoot(serviceRoot);

  const modeFiles =
    mode === "dev"
      ? ["env.dev", ".env.dev", ".env"]
      : mode === "docker"
      ? ["env.docker", ".env.docker", ".env"]
      : [".env"];

  const layers = [repoRoot, familyDir, serviceRoot];
  const candidates: string[] = [];
  for (const dir of layers)
    for (const name of modeFiles) candidates.push(path.join(dir, name));

  // Load in declared order; later files overwrite earlier ones.
  let loadedAny = false;
  for (const p of candidates) loadedAny = loadIfExists(p) || loadedAny;

  // Dev/docker must load something; prod may rely on injected envs.
  const allowMissing =
    mode === "production" && (opts.allowMissingInProd ?? true);
  if (!loadedAny && !allowMissing) {
    throw new Error(
      `No env files found for mode="${mode}". Looked in:\n` +
        candidates.map((p) => `  - ${p}`).join("\n")
    );
  }
}

/** Assertions / getters */
export function assertEnv(keys: string[]) {
  const missing = keys.filter(
    (k) => !process.env[k] || !String(process.env[k]).trim()
  );
  if (missing.length)
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

export function requireEnum(name: string, allowed: string[]): string {
  const v = requireEnv(name);
  if (!allowed.includes(v))
    throw new Error(
      `Invalid env var ${name}="${v}". Allowed: ${allowed.join(", ")}`
    );
  return v;
}

export function requireNumber(name: string): number {
  const v = requireEnv(name);
  if (!/^-?\d+(\.\d+)?$/.test(v))
    throw new Error(`Env var ${name} must be a number, got "${v}"`);
  return Number(v);
}

export function requireBoolean(name: string): boolean {
  const v = requireEnv(name).toLowerCase();
  if (v !== "true" && v !== "false")
    throw new Error(`Env var ${name} must be "true" or "false"`);
  return v === "true";
}

export function requireUrl(name: string): string {
  const v = requireEnv(name);
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`Env ${name} must be a valid URL`);
  }
  if (!/^https?:$/.test(u.protocol))
    throw new Error(`Env ${name} must be http or https URL`);
  return v;
}

export function requireJson<T = unknown>(name: string): T {
  const v = requireEnv(name);
  try {
    return JSON.parse(v) as T;
  } catch {
    throw new Error(`Env ${name} must be valid JSON`);
  }
}

/** Redact helper for logging maps of envs (never dump real values to logs). */
export function redactEnv(
  obj: Record<string, unknown>
): Record<string, string> {
  return Object.fromEntries(Object.keys(obj).map((k) => [k, "***redacted***"]));
}
