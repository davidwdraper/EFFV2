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
 * - JWKS is mounted in app.internal BEFORE verifyS2S — do NOT mount it here.
 */

import { Router } from "express";
import { createSvcconfigRouter } from "./svcconfig";
import { createProxyRouter } from "./proxy";

export function createInternalRouter(): import("express").Router {
  const r = Router();

  // DO NOT mount JWKS here (it must be public on the internal listener).
  // r.use("/.well-known/jwks.json", jwksRouter); // ← removed on purpose

  r.use("/_internal/svcconfig", createSvcconfigRouter());
  r.use("/internal/call", createProxyRouter());

  r.get("/_internal/health", (_req, res) => res.json({ status: "ok" }));

  return r;
}
