// backend/services/gateway/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Bootstrap via shared Bootstrap: load envs, warm SvcConfig mirror, start HTTP.
 *
 * Env:
 * - SVC_NAME (required) — service identity for logging; HARD STOP if missing.
 */

import { resolve } from "path";
import { config as loadEnv } from "dotenv";
import { Bootstrap } from "@nv/shared";
import { GatewayApp } from "./app";
import { getSvcConfig } from "./services/svcconfig";
import { setLogger } from "@nv/shared/util/logger.provider";
import { log } from "@nv/shared/util/Logger";

// Load env early so we can HARD-STOP if SVC_NAME is missing.
// (Bootstrap will load again; double-load is harmless and keeps this check simple.)
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), ".env.dev"), override: true });

// HARD STOP if SVC_NAME is not set
const svcName = (process.env.SVC_NAME || "").trim();
if (!svcName) {
  // Unbound error (or bind with a generic context)
  log
    .bind({ slug: "gateway", version: 1, url: "startup" })
    .error("fatal_missing_env - SVC_NAME is required but not set");
  process.exit(1);
}

async function main(): Promise<void> {
  const boot = new Bootstrap({
    service: svcName,
    // Reads PORT from env; defaults handled inside Bootstrap.
    // Loads .env then .env.dev (override) before preStart.
    preStart: async () => {
      // Ensure svcconfig is loaded before we accept traffic.
      await getSvcConfig().load();
    },
  });

  // Register the process-wide logger so background modules can use getLogger()
  setLogger(boot.logger);

  await boot.run(() => new GatewayApp().instance);
}

main().catch((err) => {
  // Use shared logger; bind with service context for consistency
  log
    .bind({ slug: svcName, version: 1, url: "startup" })
    .error(`boot_failed - ${String(err)}`);
  process.exit(1);
});
