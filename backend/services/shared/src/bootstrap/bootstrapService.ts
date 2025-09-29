// backend/services/shared/src/bootstrap/bootstrapService.ts
/**
 * NowVibin — Backend Shared
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
 * - Discovery policy:
 *   - Gateway: holds the full svcconfig mirror (and LKG).
 *   - Other services: resolve specific slugs via gateway internal (no full map).
 *
 * Defaults (simple & boring):
 * - discoveryMode: "via-gateway"
 * - requireSvcconfig: false
 * - svcconfigTimeoutMs: 2000 (ignored unless requireSvcconfig=true)
 */

import type { Express } from "express";
import type { StartedService } from "./startHttpService";
import { startHttpService } from "./startHttpService";
import { loadEnvCascadeForService, assertEnv, requireNumber } from "../env";
import path from "node:path";
import fs from "node:fs";

export type BootstrapOptions = {
  serviceName: string;
  /** Service root directory (e.g., path.resolve(__dirname) from index.ts) */
  serviceRootAbs: string;
  createApp: () => Express;
  /** Name of the env var carrying the port for this service. */
  portEnv?: string;
  /** Additional required env vars (besides the port). */
  requiredEnv?: string[];
  /** Runs after env + logger init, before HTTP bind. Good for DB connects. */
  beforeStart?: () => Promise<void> | void;
  onStarted?: (svc: StartedService) => void;

  /**
   * Discovery policy:
   * - "gateway": this process is the gateway and talks to the authority directly.
   * - "via-gateway": this process is a leaf service and uses gateway internal discovery.
   */
  discoveryMode?: "gateway" | "via-gateway";

  /**
   * If true, enforce live→LKG→fail before binding the port.
   * Gateway should set true; others usually leave false.
   */
  requireSvcconfig?: boolean;

  /** LKG file (gateway only). Defaults to serviceRootAbs/var/svcconfig.lkg.json */
  lkgPathRel?: string;

  /** How long to wait for live mirror warmup before consulting LKG. */
  svcconfigTimeoutMs?: number;

  /**
   * Non-prod only, OPT-IN: load repo-root env files if required vars are missing.
   * Default is STRICT (false) to satisfy SOP: no silent fallbacks.
   */
  repoEnvFallback?: boolean;
  /** Candidate repo-root files (applied in order, override=false) if repoEnvFallback=true. */
  repoEnvCandidates?: string[];
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

    discoveryMode = "via-gateway",
    requireSvcconfig = false,
    lkgPathRel = "var/svcconfig.lkg.json",
    svcconfigTimeoutMs = 2000,

    // STRICT by default — services may opt-in per dev convenience
    repoEnvFallback = false,
    repoEnvCandidates = [
      process.env.ENV_FILE?.trim(),
      ".env",
      ".env.dev",
      "env.dev",
    ].filter(Boolean) as string[],
  } = opts;

  // 1) Env cascade (repo → family → service); later files overwrite earlier ones.
  loadEnvCascadeForService(serviceRootAbs);

  // 2) Validate required envs (strict; no guessing).
  const mustHave = [portEnv, ...requiredEnv];

  if (requireSvcconfig) {
    if (discoveryMode === "gateway") {
      mustHave.push("SVCCONFIG_AUTHORITY_BASE_URL"); // gateway talks to authority
      mustHave.push("SVCCONFIG_LIST_PATH");
    } else {
      mustHave.push("GATEWAY_INTERNAL_BASE_URL"); // services talk to gateway internal
    }
  }
  assertEnv(mustHave);

  // 2a) Optional: Non-prod repo-root fallback (OPT-IN ONLY).
  if (repoEnvFallback) {
    const nodeEnv = (process.env.NODE_ENV || "dev").toLowerCase();
    const missing = mustHave.filter(
      (k) => !process.env[k] || !String(process.env[k]).trim()
    );
    if (nodeEnv !== "production" && missing.length > 0) {
      const repoRoot = findRepoRoot(serviceRootAbs);
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

  // 3) Init logger AFTER env is present (use relative require to avoid ESM headaches).
  const { initLogger, logger } =
    require("../utils/logger") as typeof import("../utils/logger");
  initLogger(serviceName);

  // 4) Discovery warmup (gateway mirrors; services stay skinny).
  if (requireSvcconfig) {
    const lkgPathAbs = path.join(serviceRootAbs, lkgPathRel);
    logger.debug(
      { discoveryMode, timeoutMs: svcconfigTimeoutMs, lkgPathAbs },
      "[bootstrap] svcconfig warmup begin"
    );

    // Dynamic feature detection to match current client.ts without churn.
    const cli: any = require("../svcconfig/client");

    if (discoveryMode === "gateway") {
      // Prefer new name; fall back to older startSvcconfigMirror.
      const startFullMirror =
        typeof cli.startAuthorityMirror === "function"
          ? cli.startAuthorityMirror
          : typeof cli.startSvcconfigMirror === "function"
          ? cli.startSvcconfigMirror
          : null;

      if (!startFullMirror) {
        logger.fatal(
          {},
          "[bootstrap] svcconfig full-mirror function missing (expected startAuthorityMirror or startSvcconfigMirror)"
        );
        throw new Error("svcconfig client: no full-mirror start function");
      }

      // Kick an initial attempt immediately.
      try {
        await startFullMirror();
      } catch {
        /* swallow; will retry during wait window */
      }

      await waitForLiveOrLKG(cli, logger, {
        timeoutMs: svcconfigTimeoutMs,
        lkgPathAbs,
        allowLKG: typeof cli.loadLKGSnapshot === "function",
        fatalIfEmpty: true,
      });

      // Opportunistically persist LKG if live is fresh (only if helper exists).
      if (typeof cli.saveLKGSnapshotIfFresh === "function") {
        try {
          await cli.saveLKGSnapshotIfFresh(lkgPathAbs);
        } catch {
          /* non-fatal */
        }
      }
    } else {
      // Non-gateway services do NOT mirror the full map.
      if (typeof cli.startGatewayBackedResolver === "function") {
        await cli.startGatewayBackedResolver();
      } else {
        logger.debug(
          "[bootstrap] startGatewayBackedResolver not present; relying on lazy per-call resolution"
        );
      }
      logger.debug("[bootstrap] via-gateway resolver initialized");
    }
  }

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

/** Find repo root by walking up until .git or workspace manifest is found. */
function findRepoRoot(serviceRootAbs: string): string {
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
}

async function waitForLiveOrLKG(
  cli: any,
  logger: { debug: Function; info: Function; warn: Function; fatal: Function },
  opts: {
    timeoutMs: number;
    lkgPathAbs: string;
    allowLKG: boolean;
    fatalIfEmpty: boolean;
  }
) {
  const { timeoutMs, lkgPathAbs, allowLKG, fatalIfEmpty } = opts;
  const until = Date.now() + Math.max(300, timeoutMs);

  // Choose a “fetch once” function if available (supports both new/legacy names).
  const tryFetchOnce =
    typeof cli.startAuthorityMirror === "function"
      ? cli.startAuthorityMirror
      : typeof cli.startSvcconfigMirror === "function"
      ? cli.startSvcconfigMirror
      : null;

  let nextAttemptAt = 0;

  for (;;) {
    const snap =
      typeof cli.getSvcconfigSnapshot === "function"
        ? cli.getSvcconfigSnapshot()
        : null;

    if (snap && Object.keys(snap.services ?? {}).length > 0) {
      logger.info(
        { count: Object.keys(snap.services).length, version: snap.version },
        "[bootstrap] svcconfig live snapshot ready"
      );
      return;
    }

    // Retry fetch every ~300ms within the window (handles late authority startup).
    if (tryFetchOnce && Date.now() >= nextAttemptAt) {
      try {
        await tryFetchOnce();
      } catch {
        // non-fatal; keep trying until timeout
      }
      nextAttemptAt = Date.now() + 300;
    }

    if (Date.now() >= until) break;
    await sleep(100);
  }

  if (allowLKG && typeof cli.loadLKGSnapshot === "function") {
    try {
      const loaded = await cli.loadLKGSnapshot(lkgPathAbs);
      if (loaded) {
        logger.warn(
          { lkgPathAbs },
          "[bootstrap] live svcconfig unavailable; using LKG snapshot"
        );
        return;
      }
    } catch (err) {
      logger.debug({ err: String(err) }, "[bootstrap] LKG load failed");
    }
  }

  if (fatalIfEmpty) {
    logger.fatal(
      { lkgPathAbs },
      "[bootstrap] svcconfig unavailable and no LKG present — refusing to start"
    );
    throw new Error("svcconfig not ready (no live data, no LKG)");
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
