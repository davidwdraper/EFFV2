// backend/services/shared/env.ts

/**
 * Docs:
 * - Design: docs/design/backend/config/env-loading.md
 * - Architecture: docs/architecture/backend/CONFIG.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *
 * Why:
 * - New services often failed to boot because envs were defined at the repo root
 *   (or the service family dir) and not copied into the service’s folder.
 * - Fix: load env files **by layer** with deterministic precedence:
 *     1) repo root  → base/project-wide defaults
 *     2) service family dir (e.g., backend/services) → team/service-class defaults
 *     3) service root (e.g., backend/services/user) → service-specific overrides
 *   Within each layer: try the **mode-specific** file first (e.g., .env.dev),
 *   then fall back to `.env`. **Later loads always override earlier ones.**
 *
 * Notes:
 * - In production we prefer injected env; `.env` files are optional.
 * - Dev/docker modes require their files somewhere in the cascade or we fail fast.
 * - We use dotenv-expand so `${VAR}` references work across files.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";

/** Find the first directory upward from `start` that contains any of the markers. */
function findRootWithMarkers(start: string, markers: string[]): string | null {
  let dir = path.resolve(start);
  for (;;) {
    for (const m of markers) {
      if (fs.existsSync(path.join(dir, m))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load a single env file if it exists; expand vars; return true if loaded. */
function loadIfExists(absPath: string): boolean {
  if (!fs.existsSync(absPath)) return false;
  const parsed = dotenv.config({ path: absPath });
  if (parsed.error) {
    throw new Error(
      `Failed to load env file: ${absPath} — ${String(parsed.error)}`
    );
  }
  dotenvExpand.expand(parsed);
  return true;
}

/** Load several files in order, later files override earlier ones. Throws if none loaded (unless allowMissing). */
export function loadEnvFilesOrThrow(
  files: string[],
  opts: { allowMissing?: boolean } = {}
) {
  let loadedAny = false;
  for (const f of files) {
    const abs = path.resolve(f);
    loadedAny = loadIfExists(abs) || loadedAny;
  }
  if (!loadedAny && !opts.allowMissing) {
    throw new Error(`No env files loaded from: ${files.join(", ")}`);
  }
}

/**
 * NEW: Cascading loader for a service.
 *
 * Order (always):
 *   repoRoot → serviceFamilyDir → serviceRoot
 * At each layer we try: [modeFile, fallbackFile].
 *   - dev:    modeFile=".env.dev",     fallbackFile=".env"
 *   - docker: modeFile=".env.docker",  fallbackFile=".env"
 *   - other:  modeFile=".env" (only)
 *
 * Examples:
 *   <repo>/.env.dev
 *   <repo>/backend/services/.env.dev
 *   <repo>/backend/services/<svc>/.env.dev
 *   (then fallbacks to .env in the same three locations)
 */
export function loadEnvCascadeForService(
  serviceRootAbs: string,
  opts: { allowMissingInProd?: boolean } = {}
) {
  const mode = (process.env.NODE_ENV || "").trim();
  if (!mode)
    throw new Error("NODE_ENV is required (dev | docker | production).");

  const serviceRoot = path.resolve(serviceRootAbs);
  const serviceFamilyDir = path.dirname(serviceRoot);

  // repoRoot: look upward for common markers
  const repoRoot =
    findRootWithMarkers(serviceRoot, [
      ".git",
      "pnpm-workspace.yaml",
      "package.json",
    ]) || path.resolve(serviceRoot, "..", ".."); // last-ditch guess

  const modeFiles =
    mode === "dev"
      ? [".env.dev", ".env"]
      : mode === "docker"
      ? [".env.docker", ".env"]
      : [".env"]; // production: only .env if present (optional)

  const layers = [repoRoot, serviceFamilyDir, serviceRoot];

  const candidates: string[] = [];
  for (const dir of layers) {
    for (const name of modeFiles) {
      const abs = path.join(dir, name);
      candidates.push(abs);
    }
  }

  // Load in declared order; later files overwrite earlier ones.
  let loadedAny = false;
  for (const p of candidates) {
    loadedAny = loadIfExists(p) || loadedAny;
  }

  // Dev/docker must load **something**; prod may rely on injected env.
  const allowMissing =
    mode === "production" && (opts.allowMissingInProd ?? true);

  if (!loadedAny && !allowMissing) {
    throw new Error(
      `No env files found for mode="${mode}". Looked in:\n` +
        candidates.map((p) => `  - ${p}`).join("\n")
    );
  }
}

/**
 * DEPRECATED: single-file loader by NODE_ENV.
 * Prefer `loadEnvCascadeForService(serviceRootAbs)` for new services.
 */
export function loadEnvFileOrDie() {
  const mode = process.env.NODE_ENV;
  if (!mode)
    throw new Error("NODE_ENV is required (dev | docker | production).");

  const preferred =
    mode === "docker"
      ? [".env.docker", ".env"]
      : mode === "dev"
      ? [".env.dev", ".env"]
      : [".env"];

  const cwd = process.cwd();
  // Walk upward for the first match, then load that one file.
  let toLoad: string | null = null;
  let dir = cwd;
  outer: for (;;) {
    for (const name of preferred) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        toLoad = p;
        break outer;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!toLoad && mode !== "production") {
    throw new Error(
      `Required env file not found (searched up from ${cwd}: ${preferred.join(
        ", "
      )})`
    );
  }
  if (toLoad) loadIfExists(toLoad);
}

/** Convenience (older call sites): merge exactly these two, root then service overrides. */
export function loadServiceAndRootEnvOrThrow(
  serviceEnvAbs: string,
  repoRootEnvAbs: string
) {
  loadEnvFilesOrThrow([repoRootEnvAbs, serviceEnvAbs], { allowMissing: true });
}

/** Assertions / getters */
export function assertRequiredEnv(keys: string[]) {
  const missing = keys.filter(
    (k) => !process.env[k] || !String(process.env[k]).trim()
  );
  if (missing.length)
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

/** Alias retained for SOP/compat: */
export function assertEnv(keys: string[]) {
  return assertRequiredEnv(keys);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

export function requireEnum(name: string, allowed: string[]): string {
  const v = requireEnv(name);
  if (!allowed.includes(v)) {
    throw new Error(
      `Invalid env var ${name}="${v}". Allowed: ${allowed.join(", ")}`
    );
  }
  return v;
}

export function requireNumber(name: string): number {
  const v = requireEnv(name);
  if (!/^\d+$/.test(v))
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
