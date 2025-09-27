// backend/services/shared/src/bootstrap/bootstrapService.ts
/**
 * See ADR-0033 — centralized env loading; strict (no fallbacks) by default.
 * NOTE: Inside @eff/shared, use RELATIVE imports. Consumers use package subpaths.
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
  /** Name of the env var that carries the port for this service. REQUIRED. */
  portEnv?: string;
  /** Additional required env vars (besides the port). */
  requiredEnv?: string[];
  /** Runs after env + logger init, before HTTP bind. Good for DB connects. */
  beforeStart?: () => Promise<void> | void;
  onStarted?: (svc: StartedService) => void;
  /**
   * Non-prod only, OPT-IN: load repo-root env files if required vars are missing.
   * Default is STRICT (false) to satisfy SOP: no silent fallbacks.
   */
  repoEnvFallback?: boolean;
  /** Candidate repo-root files (applied in order, override=false) if repoEnvFallback=true. */
  repoEnvCandidates?: string[];
  /** Start svcconfig mirror early (non-blocking). */
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
    // STRICT by default — services may opt-in per dev convenience
    repoEnvFallback = false,
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

  // 1a) Optional: Non-prod repo-root fallback (OPT-IN ONLY).
  if (repoEnvFallback) {
    const nodeEnv = (process.env.NODE_ENV || "dev").toLowerCase();
    const mustHave = [portEnv, ...requiredEnv];
    const missing = mustHave.filter(
      (k) => !process.env[k] || !String(process.env[k]).trim()
    );
    if (nodeEnv !== "production" && missing.length > 0) {
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
          `[${serviceName}] loaded repo env fallback (non-prod, opt-in):\n  - ${loaded.join(
            "\n  - "
          )}`
        );
      }
    }
  }

  // 2) Optionally start svcconfig mirror (AFTER envs).
  if (startSvcconfig) {
    try {
      // Use CJS require to avoid ESM .js extension requirement.
      const { startSvcconfigMirror } =
        require("../svcconfig/client") as typeof import("../svcconfig/client");
      void startSvcconfigMirror();
    } catch {
      /* keep boot resilient; httpClientBySlug can lazy-start */
    }
  }

  // 3) Assert required envs (STRICT).
  const mustHave = [portEnv, ...requiredEnv];
  assertEnv(mustHave);

  // 4) Init logger AFTER env is present (use relative require).
  const { initLogger, logger } =
    require("../utils/logger") as typeof import("../utils/logger");
  initLogger(serviceName);

  // 5) Optional pre-bind hook (e.g., connect DB).
  if (beforeStart) {
    await Promise.resolve(beforeStart());
  }

  // 6) Build and start HTTP — STRICT: no magic defaults.
  const app = createApp();
  const port = requireNumber(portEnv);
  const started = startHttpService({ app, port, serviceName, logger });

  onStarted?.(started);
  return started;
}
