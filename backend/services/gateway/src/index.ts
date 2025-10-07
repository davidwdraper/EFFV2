// backend/services/gateway/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0001 (Gateway-Embedded SvcConfig mirror)
 * - ADR-0014 (Base Hierarchy — ServiceEntrypoint vs ServiceBase)
 *
 * Purpose:
 * - Start the Gateway service.
 * - Let GatewayApp warm its SvcConfig internally; no poking internals here.
 *
 * Notes:
 * - ServiceEntrypointOptions in your tree does NOT accept `portEnv` or `port`.
 *   It resolves PORT internally. Keep options minimal to avoid type drift.
 */

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { GatewayApp } from "./app";

async function main(): Promise<void> {
  const app = new GatewayApp();

  await new ServiceEntrypoint({
    service: "gateway",
  }).run(() => app.instance);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal gateway startup", err);
  process.exit(1);
});
