/**
 * NowVibin — Backend Shared
 * File: backend/services/shared/src/bootstrap/bootstrapService.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Centralized, deterministic bootstrap for all services.
 * - Strict env validation (no import-time reads; validate at boot).
 * - Per ADR-0034: services should NOT require SVCCONFIG_* directly.
 *   If legacy code still references it, we opportunistically derive
 *   SVCCONFIG_BASE_URL from the gateway’s internal discovery endpoint.
 */

import type { Express } from "express";
import type { StartedService } from "./startHttpService";
import { startHttpService } from "./startHttpService";
import { loadEnvCascadeForService, assertEnv, requireNumber } from "../env";
import path from "node:path";
import fs from "node:fs";

// Small helper: if SVCCONFIG_BASE_URL is absent but the service knows the
// gateway internal base, perform a fast, internal discovery call to set it.
// This preserves compatibility for any legacy modules still reading the var
// while keeping ADR-0034’s rule: services do not *require* it.
async function deriveSvcconfigFromGatewayIfMissing(): Promise<void> {
  const hasSvc =
    !!process.env.SVCCONFIG_BASE_URL &&
    process.env.SVCCONFIG_BASE_URL.trim() !== "";
  if (hasSvc) return;

  const gw =
    process.env.GATEWAY_INTERNAL_BASE_URL?.trim() ||
    process.env.GATEWAY_BASE_URL?.trim();
  if (!gw) return; // Nothing to do; service might not need svcconfig at all.

  try {
    const token =
      (process.env.S2S_BEARER && process.env.S2S_BEARER.trim()) ||
      (process.env.S2S_TOKEN && process.env.S2S_TOKEN.trim()) ||
      "";

    const url = `${gw.replace(/\/+$/, "")}/_internal/svcconfig/base-url`;
    const ac = AbortController as any;
    const signal =
      typeof ac?.timeout === "function"
        ? ac.timeout(Number(process.env.S2S_JWKS_TIMEOUT_MS || 3000))
        : undefined;

    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      // @ts-ignore TS lib may not include AbortSignal.timeout yet in your TS target
      signal,
    });

    if (!res.ok) return; // keep silent; not all services need it
    const data = (await res.json()) as { baseUrl?: string };
    if (data?.baseUrl) {
      process.env.SVCCONFIG_BASE_URL = data.baseUrl;
    }
  } catch {
    // Silent: discovery is best-effort for legacy compatibility only.
  }
}

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
    // Per ADR-0034: default to NOT starting any per-service svcconfig mirror.
    // Gateway owns discovery and caching; services call gateway internal.
    startSvcconfig = false,
  } = opts;

  // 1) Env cascade (repo → family → service); later files overwrite earlier ones.
  loadEnvCascadeForService(serviceRootAbs);

  // 1a) ADR-0034 bridge: if legacy modules expect SVCCONFIG_BASE_URL,
  // and it isn’t set, try to derive it from gateway (internal).
  await deriveSvcconfigFromGatewayIfMissing();

  // 1b) Optional: Non-prod repo-root fallback (OPT-IN ONLY).
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

  // 2) Optionally start svcconfig mirror (AFTER envs) — generally off per ADR-0034.
  if (startSvcconfig) {
    try {
      // Use CJS require to avoid ESM .js extension requirement.
      const { startSvcconfigMirror } =
        require("../svcconfig/client") as typeof import("../svcconfig/client");
      void startSvcconfigMirror();
    } catch {
      /* keep boot resilient; httpClientBySlug can lazy-start if it truly needs it */
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
