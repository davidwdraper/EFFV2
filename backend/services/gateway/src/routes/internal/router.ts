// backend/services/gateway/src/routes/internal/router.ts
/**
 * NowVibin — Gateway (Internal)
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Factory that builds the internal-only router under S2S guard (mounted by app.internal).
 * - Imports match actual exports: jwks = default router; svcconfig/proxy = factories.
 */

import { Router } from "express";
import jwksRouter from "./jwks"; // default export (router instance)
import { createSvcconfigRouter } from "./svcconfig"; // named factory
import { createProxyRouter } from "./proxy"; // named factory

export function createInternalRouter(): import("express").Router {
  const r = Router();

  // Internal JWKS
  r.use("/.well-known/jwks.json", jwksRouter);

  // Discovery + Proxy (factories)
  r.use("/_internal/svcconfig", createSvcconfigRouter());
  r.use("/internal/call", createProxyRouter());

  // Lightweight internal health
  r.get("/_internal/health", (_req, res) => res.json({ status: "ok" }));

  return r;
}
