// backend/services/svcfacilitator/src/bootstrap.v2.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/bootstrap.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0002 — SvcFacilitator Minimal (bootstrap & purpose)
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys)
 *   - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0019 — Class Routers via RouterBase
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *
 * Purpose:
 * - **Assembly-only** composition for v2. No business logic, no side effects beyond wiring.
 * - Construct DI graph (DbClient → Repo → Loader → Store → Controllers → App).
 * - Read only the minimum env needed for assembly parameters (TTL, FS LKG path).
 *
 * Invariants:
 * - No hidden defaults. Fail fast if required env is missing.
 * - No barrels/shims. Explicit imports only.
 * - `app.v2.ts` remains orchestration-only; all construction happens here.
 */

import { SvcFacilitatorApp } from "./app.v2";

// Service-owned DB client (reads env internally in services/db.ts)
import { getSvcFacilitatorDb } from "./services/db.v2";

// Compounded mirror path
import { SvcConfigWithPoliciesRepoV2 } from "./repos/SvcConfigWithPoliciesRepo.v2";
import { MirrorDbLoader as MirrorDbLoaderV2 } from "./services/MirrorDbLoader.v2";
import { MirrorStoreV2 } from "./services/mirrorStore.v2";

// Controllers (thin; DI with store)
import { ResolveController } from "./controllers/ResolveController.v2";
import { MirrorController } from "./controllers/MirrorController.v2";

// ── Env helpers (assembly parameters only) ───────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`ENV ${name} is required but not set`);
  }
  return v.trim();
}

function requireIntEnv(name: string): number {
  const raw = requireEnv(name);
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`ENV ${name} must be a non-negative integer`);
  }
  return n;
}

// ── Bootstrap factory (pure assembly; exported for tests/runners) ────────────

export function createSvcFacilitatorApp(): SvcFacilitatorApp {
  // Assembly parameters (behavior knobs)
  // - MIRROR_TTL_MS: in-memory TTL for mirror snapshots
  // - SVCCONFIG_LKG_PATH: filesystem LKG JSON path (FS-first fallback)
  const ttlMs = requireIntEnv("MIRROR_TTL_MS");
  const fsLkgPath = requireEnv("SVCCONFIG_LKG_PATH");

  // Service-owned DB client
  const dbClient = getSvcFacilitatorDb();

  // Repo → Loader
  const repo = new SvcConfigWithPoliciesRepoV2(dbClient);
  const loader = new MirrorDbLoaderV2(repo);

  // Store (TTL + FS LKG primary, DB LKG secondary best-effort)
  const store = new MirrorStoreV2({
    ttlMs,
    loader,
    fsPath: fsLkgPath,
    db: dbClient,
  });

  // Controllers
  const resolveController = new ResolveController(store);
  const mirrorController = new MirrorController(store);

  // App (orchestration-only)
  const app = new SvcFacilitatorApp({
    store,
    resolveController,
    mirrorController,
    // routePolicyRouter: optional — inject if/when you version that router
  });

  return app;
}

// Default export for convenience in runners/tests
export default createSvcFacilitatorApp;
