// backend/services/jwks/src/composition/JwksModule.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/composition/JwksModule.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0017 — JWKS Service carve-out (policy/public route)
 * - ADR-0035 — JWKS via GCP KMS with TTL Cache
 *
 * Purpose (single concern):
 * - Orchestrate JWKS pieces:
 *   1) Assert env (fail-fast)
 *   2) Build provider via factory (GCP KMS v1)
 *   3) Wrap with TTL cache
 *   4) DI into controller
 *   5) Return configured Router
 *
 * Invariants:
 * - Dev == Prod (behavior identical; only env values differ)
 * - No literals or fallbacks; all config via env
 * - No caching inside provider; cache owned by JwksCache
 */

import type { Router } from "express";
import { JwksEnv } from "../env/JwksEnv";
import { JwksProviderFactory } from "../provider/JwksProviderFactory";
import type { IJwksProvider } from "../provider/IJwksProvider";
import { JwksCache } from "../jwks/JwksCache";
import { JwksController } from "../controllers/JwksController";
import { JwksRouter } from "../routes/jwks.router";

export function buildJwksRouter(): Router {
  // 1) Fail-fast env validation
  const env = JwksEnv.assert();

  // 2) Concrete provider (GCP KMS for ADR-0035 v1)
  const baseProvider: IJwksProvider = JwksProviderFactory.create(env);

  // 3) TTL cache wrapper (thundering-herd safe)
  const cache = new JwksCache(env.NV_JWKS_CACHE_TTL_MS, () =>
    baseProvider.getJwks()
  );

  // 4) Controller DI — expose cache as IJwksProvider
  const controller = new JwksController({ getJwks: () => cache.get() });

  // 5) Router (class) wiring — one-liners inside RouterBase.configure()
  const router = new JwksRouter(controller).router();

  return router;
}
