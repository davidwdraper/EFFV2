// backend/services/gateway/index.ts
/**
 * NowVibin — Gateway Entry
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Boot the public gateway (4000) using shared bootstrap.
 * - Gateway owns full svcconfig mirror + LKG per ADR-0034.
 */

import path from "node:path";
import type { Express } from "express";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

function isExpressApp(x: any): x is Express {
  return !!x && typeof x.use === "function" && typeof x.listen === "function";
}

/**
 * Load the Express app from ./src/app, accepting multiple export shapes:
 * - function buildGatewayApp(): Express
 * - function createGatewayApp(): Express
 * - function createApp(): Express
 * - const app: Express
 * - default export: function or Express instance
 */
function createGatewayApp(): Express {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("./src/app");

  const candidates = [
    mod.buildGatewayApp,
    mod.createGatewayApp,
    mod.createApp,
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
    `[gateway] Could not obtain Express app from ./src/app. ` +
      `Export one of buildGatewayApp(), createGatewayApp(), createApp(), a default function, or an Express instance named "app". ` +
      `Found exports: ${keys.join(", ") || "(none)"}`
  );
}

(async () => {
  await bootstrapService({
    serviceName: "gateway",
    serviceRootAbs: path.resolve(__dirname),
    createApp: createGatewayApp,
    portEnv: "GATEWAY_PUBLIC_PORT",

    // Gateway-only discovery knobs:
    discoveryMode: "gateway",
    requireSvcconfig: true,
    svcconfigTimeoutMs: 8000, // give authority a real window during dev
  });
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[gateway] fatal during bootstrap:", err);
  process.exit(1);
});
