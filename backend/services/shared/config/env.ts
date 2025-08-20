// backend/services/shared/config/env.ts

import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";

/** Load a specific env file. Throws if the file is missing or invalid. */
export function loadEnvFromFileOrThrow(envFilePath: string) {
  if (!envFilePath || envFilePath.trim() === "") {
    throw new Error("ENV_FILE is required but was not provided.");
  }
  const resolved = path.resolve(process.cwd(), envFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`ENV_FILE not found at: ${resolved}`);
  }

  const parsed = dotenv.config({ path: resolved });
  if (parsed.error) {
    throw new Error(
      `Failed to load ENV_FILE: ${resolved} — ${String(parsed.error)}`
    );
  }
  dotenvExpand.expand(parsed);
}

/** Assert required environment variables are present (non-empty). */
export function assertRequiredEnv(keys: string[]) {
  const missing: string[] = [];
  for (const k of keys) {
    const v = process.env[k];
    if (!v || v.trim() === "") missing.push(k);
  }
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

/** Require a non-empty env var; returns trimmed string. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env: ${name}`);
  return v.trim();
}

/** Require an env var that parses to a finite number. */
export function requireNumber(name: string): number {
  const v = requireEnv(name);
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new Error(`Env ${name} must be a finite number`);
  return n;
}

/** Typed upstream selector so controllers/routes can safely fetch service URLs. */
export type UpstreamKey =
  | "USER_SERVICE_URL"
  | "ACT_SERVICE_URL"
  | "PLACE_SERVICE_URL"
  | "EVENT_SERVICE_URL"
  | "AUTH_SERVICE_URL"
  | "IMAGE_SERVICE_URL";

export function requireUpstream(name: UpstreamKey): string {
  return requireEnv(name);
}
