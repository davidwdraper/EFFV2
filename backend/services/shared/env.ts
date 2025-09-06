// backend/services/shared/env.ts
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";

/** Find the first existing file walking up from start, trying each candidate name in order. */
function findUp(start: string, candidates: string[]): string | null {
  let dir = start;
  for (;;) {
    for (const name of candidates) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load one or more .env files. Later files win by default (override earlier). */
export function loadEnvFilesOrThrow(
  files: string[],
  opts: { allowMissing?: boolean; order?: "first-wins" | "last-wins" } = {}
) {
  const order = opts.order ?? "last-wins";
  const list = order === "last-wins" ? files : [...files].reverse();

  let loadedAny = false;
  for (const f of list) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) {
      if (opts.allowMissing) continue;
      throw new Error(`Env file not found: ${abs}`);
    }
    const parsed = dotenv.config({ path: abs });
    if (parsed.error) {
      throw new Error(
        `Failed to load env file: ${abs} — ${String(parsed.error)}`
      );
    }
    dotenvExpand.expand(parsed);
    loadedAny = true;
  }
  if (!loadedAny) throw new Error("No env files loaded");
}

/**
 * NODE_ENV-driven loader:
 * - dev     -> .env.dev
 * - docker  -> .env.docker
 * - default -> .env  (prod may rely on injected env and can skip file)
 * Searches upward from cwd for the first matching file.
 */
export function loadEnvFileOrDie() {
  const mode = process.env.NODE_ENV;
  if (!mode)
    throw new Error("NODE_ENV is required (dev | docker | production).");

  const preferred =
    mode === "docker"
      ? [".env.docker"]
      : mode === "dev"
      ? [".env.dev"]
      : [".env"];

  const envPath = findUp(process.cwd(), preferred);
  if (!envPath && mode !== "production") {
    throw new Error(
      `Required env file not found (looked for ${preferred.join(
        ", "
      )}) from ${process.cwd()}`
    );
  }
  if (envPath) {
    const parsed = dotenv.config({ path: envPath });
    if (parsed.error) {
      throw new Error(
        `Failed to load env file: ${envPath} — ${String(parsed.error)}`
      );
    }
    dotenvExpand.expand(parsed);
  }
}

/** Convenience: merge service-local and repo-root envs (root first, service overrides). */
export function loadServiceAndRootEnvOrThrow(
  serviceEnvAbs: string,
  repoRootEnvAbs: string
) {
  // Root first, then service overrides
  loadEnvFilesOrThrow([repoRootEnvAbs, serviceEnvAbs], {
    allowMissing: true,
    order: "last-wins",
  });
}

/** Assertions / getters (superset of both old files) */
export function assertRequiredEnv(keys: string[]) {
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

/** Redact helper for logging maps of envs */
export function redactEnv(
  obj: Record<string, unknown>
): Record<string, string> {
  return Object.fromEntries(Object.keys(obj).map((k) => [k, "***redacted***"]));
}
