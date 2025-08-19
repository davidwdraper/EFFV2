// backend/services/shared/env.ts

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

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

export function loadEnvFileOrDie() {
  const mode = process.env.NODE_ENV;
  if (!mode)
    throw new Error("NODE_ENV is required (dev | docker | production).");

  const preferred =
    mode === "docker"
      ? [".env.docker"]
      : mode === "dev"
      ? [".env.dev"]
      : [".env"]; // production may rely on injected vars

  const envPath = findUp(process.cwd(), preferred);
  if (!envPath && mode !== "production") {
    throw new Error(
      `Required env file not found (looked for ${preferred.join(
        ", "
      )}) from ${process.cwd()}`
    );
  }
  if (envPath) dotenv.config({ path: envPath });
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v;
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
