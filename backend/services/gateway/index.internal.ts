// backend/services/gateway/index.internal.ts
/**
 * NowVibin — Gateway Internal Entry (PRIVATE listener)
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Boot the internal control-plane listener (e.g., :4001) for discovery,
 *   S2S JWKS, and internal proxy. This process **is** the gateway, so
 *   discoveryMode = "gateway".
 */

import "tsconfig-paths/register";
import path from "node:path";
import type { Express } from "express";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

function isExpressApp(x: any): x is Express {
  return !!x && typeof x.use === "function" && typeof x.listen === "function";
}

function createInternalGatewayApp(): Express {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("./src/app.internal");

  const candidates = [
    mod.createInternalApp,
    mod.buildInternalApp,
    mod.app,
    mod.default,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (typeof candidate === "function") {
      const maybeApp = candidate();
      if (isExpressApp(maybeApp)) return maybeApp;
    } else if (isExpressApp(candidate)) {
      return candidate;
    }
  }

  const keys = Object.keys(mod);
  throw new TypeError(
    `[gateway-internal] Could not obtain Express app from ./src/app.internal. ` +
      `Export one of createInternalApp(), buildInternalApp(), a default function, or an Express instance named "app". ` +
      `Found exports: ${keys.join(", ") || "(none)"}`
  );
}

(async () => {
  await bootstrapService({
    serviceName: "gateway-internal",
    serviceRootAbs: path.resolve(__dirname),
    createApp: createInternalGatewayApp,
    portEnv: "GATEWAY_INTERNAL_PORT",

    // This process is the gateway (internal plane), so talk to authority directly.
    discoveryMode: "gateway", // ✅ fix: was "none" (invalid)

    // Keep svcconfig strict so internal plane is deterministic.
    requireSvcconfig: true,
    svcconfigTimeoutMs: 8000,
  });
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[gateway-internal] fatal during bootstrap:", err);
  process.exit(1);
});
