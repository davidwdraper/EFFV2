// backend/services/svcfacilitator/src/bootstrap.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/bootstrap.v2.ts
 *
 * Orchestration only; no business logic.
 * Boot flow: DB → MirrorStore (prewarm) → construct v2 App (routes mount inside).
 */

import { getLogger } from "@nv/shared/logger/Logger";
import { getSvcFacilitatorDb } from "./services/db.v2";

import { ServiceConfigsRepo } from "./repos/ServiceConfigsRepo";
import { RoutePoliciesRepo } from "./repos/RoutePoliciesRepo";
import { MirrorDbLoader } from "./services/MirrorDbLoader.v2";
import { MirrorStoreV2 } from "./services/mirrorStore.v2";

import { SvcFacilitatorApp } from "./app.v2";
import { ResolveController } from "./controllers/ResolveController.v2";
import { MirrorController } from "./controllers/MirrorController.v2";

const log = getLogger().bind({
  service: "svcfacilitator",
  component: "bootstrap",
  url: "/bootstrap.v2",
});

// strict env helpers (no defaults)
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

// Build the v2 app and hand back Express
async function _createSvcFacilitatorApp() {
  const dbClient = getSvcFacilitatorDb();
  log.info("SVF210 db_connect_ok", { dbName: (dbClient as any)?.dbName });

  const parentsRepo = new ServiceConfigsRepo(dbClient);
  const policiesRepo = new RoutePoliciesRepo(dbClient);
  const loader = new MirrorDbLoader(parentsRepo, policiesRepo);

  const ttlMs = requireIntEnv("SVCCONFIG_MIRROR_TTL_MS");
  const fsPath = requireEnv("SVCCONFIG_LKG_PATH");
  const mirrorStore = new MirrorStoreV2({ ttlMs, loader, fsPath });

  await mirrorStore.getWithTtl();

  const resolveController = new ResolveController(mirrorStore);
  const mirrorController = new MirrorController(mirrorStore);

  const appV2 = new SvcFacilitatorApp({
    store: mirrorStore,
    resolveController,
    mirrorController,
  });

  log.info("SVF300 app_v2_ready", { service: "svcfacilitator" });

  return { app: appV2.expressApp(), mirrorStore };
}

// Export BOTH named and default to avoid interop/alias surprises
export const createSvcFacilitatorApp = _createSvcFacilitatorApp;
export default _createSvcFacilitatorApp;
