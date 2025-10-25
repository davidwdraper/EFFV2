// backend/services/svcfacilitator/src/index.ts
/**
 * Path: backend/services/svcfacilitator/src/index.ts
 *
 * Entrypoint: awaits bootstrap and starts HTTP.
 * Environment invariance for the port (no defaults).
 */

import createSvcFacilitatorApp from "./bootstrap.v2"; // ← default import (robust)
import { getLogger } from "@nv/shared/logger/Logger";

const log = getLogger().bind({
  service: "svcfacilitator",
  component: "entrypoint",
  url: "/index",
});

// strict env helpers
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing required env: ${name}`);
  return v.trim();
}
function requireIntEnv(name: string): number {
  const raw = requireEnv(name);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number`);
  return Math.trunc(n);
}

(async () => {
  const port = requireIntEnv("SVCCONFIG_HTTP_PORT");

  const { app } = await createSvcFacilitatorApp();

  app.listen(port, () => {
    log.info("SVF001 http_listening", { port, app: "v2" });
  });
})().catch((err) => {
  log.error("svcfacilitator boot_failed", { err });
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});
