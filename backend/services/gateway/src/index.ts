// backend/services/gateway/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Bootstrap via shared Bootstrap: load envs, warm SvcConfig mirror, start HTTP.
 */

import { Bootstrap } from "@nv/shared";
import { GatewayApp } from "./app";
import { getSvcConfig } from "./services/svcconfig";

async function main(): Promise<void> {
  const boot = new Bootstrap({
    service: "gateway",
    // Reads PORT from env; defaults handled inside Bootstrap.
    // Loads .env then .env.dev (override) before preStart.
    preStart: async () => {
      // Ensure svcconfig is loaded before we accept traffic.
      await getSvcConfig().load();
    },
  });

  await boot.run(() => new GatewayApp().instance);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: 50,
      service: "gateway",
      msg: "boot_failed",
      err: String(err),
    })
  );
  process.exit(1);
});
