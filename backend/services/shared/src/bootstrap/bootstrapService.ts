// backend/services/shared/src/bootstrap/bootstrapService.ts

/**
 * Docs:
 * - Design: docs/design/backend/app/bootstrap.md
 * - Config: docs/design/backend/config/env-loading.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - One boring boot path for every service:
 *   env cascade → (non-prod) repo fallback → optional svcconfig mirror → assert → logger → beforeStart → app → HTTP.
 *
 * Notes:
 * - Inside shared, use **relative** imports to avoid self-aliasing.
 * - External services should import via @eff/shared/src/...
 */

import type { Express } from "express";
import type { StartedService } from "./startHttpService";
import { startHttpService } from "./startHttpService";
import { loadEnvCascadeForService, assertEnv, requireNumber } from "../env";
import path from "node:path";
import fs from "node:fs";

export type BootstrapOptions = {
  serviceName: string;
  /** Pass the service *root* directory (e.g., path.resolve(__dirname) from the service’s index.ts) */
  serviceRootAbs: string;
  createApp: () => Express;
  portEnv?: string;
  requiredEnv?: string[];
  /** Runs after env + logger init, before HTTP bind. Good for DB connects. */
  beforeStart?: () => Promise<void> | void;
  onStarted?: (svc: StartedService) => void;
  /** Non-prod only: load all matching repo-root files if required vars are missing (override=false). */
  repoEnvFallback?: boolean;
  /** Candidate repo-root files tried in this order; all that exist are loaded. */
  repoEnvCandidates?: string[];
  /** Start svcconfig mirror early (dynamic import, non-blocking). */
  startSvcconfig?: boolean;
};

export async function bootstrapService(
  opts: BootstrapOptions
): Promise<StartedService> {
  const {
    serviceName,
    serviceRootAbs,
    createApp,
    portEnv = "PORT",
    requiredEnv = [],
    beforeStart,
    onStarted,
    repoEnvFallback = true,
    repoEnvCandidates = [
      process.env.ENV_FILE?.trim(),
      ".env",
      ".env.dev",
      "env.dev",
    ].filter(Boolean) as string[],
    startSvcconfig = true,
  } = opts;

  // 1) Env cascade (repo → family → service); later files overwrite earlier ones.
  loadEnvCascadeForService(serviceRootAbs);

  // 1a) Non-prod repo fallback — load ALL candidates (override=false) if anything required is missing.
  const nodeEnv = (process.env.NODE_ENV || "dev").toLowerCase();
  const mustHave = [portEnv, ...requiredEnv];
  const missing = mustHave.filter(
    (k) => !process.env[k] || !String(process.env[k]).trim()
  );
  if (repoEnvFallback && nodeEnv !== "production" && missing.length > 0) {
    const repoRoot = (function findRepoRoot() {
      let dir = path.resolve(serviceRootAbs);
      for (;;) {
        if (
          fs.existsSync(path.join(dir, ".git")) ||
          fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))
        )
          return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return path.resolve(serviceRootAbs, "..", "..");
        dir = parent;
      }
    })();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require("dotenv");
    const loaded: string[] = [];
    for (const rel of repoEnvCandidates) {
      const p = path.join(repoRoot, rel);
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: false });
        loaded.push(p);
      }
    }
    if (loaded.length) {
      // eslint-disable-next-line no-console
      console.log(
        `[${serviceName}] loaded repo env fallback (non-prod):\n  - ${loaded.join(
          "\n  - "
        )}`
      );
    }
  }

  // 2) Optionally start svcconfig mirror (dynamic import AFTER envs).
  if (startSvcconfig) {
    try {
      const mod = await import("../svcconfig/client");
      void mod.startSvcconfigMirror();
    } catch {
      /* keep boot resilient; httpClientBySlug can lazy-start */
    }
  }

  // 3) Assert required envs (after fallback).
  assertEnv(mustHave);

  // 4) Init logger AFTER env is present.
  const { initLogger, logger } = await import("../utils/logger");
  initLogger(serviceName);

  // 5) Optional pre-bind hook (e.g., connect DB).
  if (beforeStart) {
    await Promise.resolve(beforeStart());
  }

  // 6) Build and start HTTP.
  const app = createApp();
  const port = Number.isFinite(Number(process.env[portEnv]))
    ? Number(process.env[portEnv])
    : requireNumber(portEnv);
  const started = startHttpService({ app, port, serviceName, logger });

  onStarted?.(started);
  return started;
}
