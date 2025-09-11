// backend/services/shared/bootstrap/bootstrapService.ts

/**
 * Docs:
 * - Design: docs/design/backend/app/bootstrap.md
 * - Config: docs/design/backend/config/env-loading.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *
 * Why:
 * - New services should start the same way: load envs with the **cascade order**
 *   (repo → family → service), **fail fast** on required envs, bind the shared
 *   logger to the service identity, and start HTTP cleanly.
 * - We **do not** import the logger module until *after* envs load, because
 *   the logger’s module init reads required env vars at import time. Dynamic
 *   import here prevents “missing LOG_* env” at bootstrap.
 *
 * Notes:
 * - Single concern: env + logger init + start HTTP. Business wiring belongs in
 *   your factory (use createServiceApp()).
 * - No edge guardrails here. Gateway owns rate-limit/timeouts/breaker/auth.
 */

import type { Express } from "express";
import type { StartedService } from "./startHttpService";
import { startHttpService } from "./startHttpService";
import { loadEnvCascadeForService, assertEnv, requireNumber } from "../env";

export type BootstrapOptions = {
  /** Slug like "act", "user" — used in logs and health output. */
  serviceName: string;
  /**
   * Absolute path to the service root directory (usually `__dirname` from src/).
   * Used by the env loader to apply the cascade: repo → family → service.
   */
  serviceRootAbs: string;
  /** Factory that returns a fully wired Express app (use createServiceApp()). */
  createApp: () => Express;
  /** Name of the port env var (default: "PORT"). */
  portEnv?: string;
  /** Extra env vars to assert in addition to the port variable. */
  requiredEnv?: string[];
  /** Optional callback after server starts (e.g., to log extra details). */
  onStarted?: (svc: StartedService) => void;
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
    onStarted,
  } = opts;

  // 1) Load envs in the strict cascade (repo → family → service). Later wins.
  loadEnvCascadeForService(serviceRootAbs);

  // 2) Validate required envs early and loudly.
  assertEnv([portEnv, ...requiredEnv]);

  // 3) Dynamically import logger AFTER envs are present (avoids import-time failures).
  const { initLogger, logger } = await import("../utils/logger");
  initLogger(serviceName);

  // 4) Build the app (use createServiceApp() in your caller).
  const app = createApp();

  // 5) Parse port and start HTTP (port can be 0 in tests for ephemeral binding).
  const port = Number.isFinite(Number(process.env[portEnv]))
    ? Number(process.env[portEnv])
    : requireNumber(portEnv);

  const started = startHttpService({ app, port, serviceName, logger });

  onStarted?.(started);
  return started;
}
