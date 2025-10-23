// backend/services/svcfacilitator/src/bootstrap.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/bootstrap.v2.ts
 *
 * Purpose
 * - DI wiring and process bootstrap for SvcFacilitator v2.
 * - No business logic; construct deps and hand them to the App.
 *
 * Invariants
 * - Fail fast on env. No hidden defaults.
 * - Pass REAL Mongo collections (must support find().toArray()).
 * - The ServiceEntrypoint.run() callback is synchronous.
 */

import { MongoClient } from "mongodb";
import { getLogger } from "@nv/shared/logger/Logger";
import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { SvcFacilitatorApp } from "./app.v2";

// Store + repo + loader
import { MirrorStoreV2 } from "./services/mirrorStore.v2";
import { MirrorDbLoader } from "./services/MirrorDbLoader.v2";
import {
  SvcConfigWithPoliciesRepoV2,
  type MinimalCollection,
} from "./repos/SvcConfigWithPoliciesRepo.v2";

// Controllers
import { ResolveController } from "./controllers/ResolveController.v2";
import { MirrorController } from "./controllers/MirrorController.v2";

const log = getLogger().bind({
  service: "svcfacilitator",
  component: "bootstrap",
  url: "/bootstrap.v2",
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`missing required env: ${name}`);
  return String(v).trim();
}

export async function createSvcFacilitatorApp() {
  // 1) Env
  const dbUri = requireEnv("SVCCONFIG_DB_URI");
  const dbName = requireEnv("SVCCONFIG_DB_NAME");
  const ttlMsRaw = requireEnv("MIRROR_TTL_MS");
  const ttlMs = Number(ttlMsRaw);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`invalid MIRROR_TTL_MS: ${ttlMsRaw}`);
  }

  // 2) Mongo connect
  log.debug({ dbUri, dbName }, "SVF200 db_connect_start");
  const client = await new MongoClient(dbUri).connect();
  const db = client.db(dbName);
  log.info({ dbName }, "SVF210 db_connect_ok");

  // 3) Collections
  const service_configs = db.collection(
    "service_configs"
  ) as unknown as MinimalCollection;
  const route_policies = db.collection(
    "route_policies"
  ) as unknown as MinimalCollection;

  // 4) Repo → Loader → Store
  const repo = new SvcConfigWithPoliciesRepoV2(service_configs, route_policies);
  const loader = new MirrorDbLoader(repo);
  const store = new MirrorStoreV2({ loader, ttlMs });

  // 5) Controllers
  const resolveController = new ResolveController(store);
  const mirrorController = new MirrorController(store);

  // 6) App
  const app = new SvcFacilitatorApp({
    store,
    resolveController,
    mirrorController,
  });

  const close = async () => {
    try {
      await client.close();
    } catch {
      /* no-op */
    }
  };

  return { app, store, close };
}

export async function main() {
  // Build everything BEFORE calling run
  const { app, store, close } = await createSvcFacilitatorApp();

  const entry = new ServiceEntrypoint({
    service: "svcfacilitator",
    // Warm mirror before listening, so first /mirror doesn’t 503.
    preStart: async () => {
      try {
        const snap = await store.getWithTtl();
        const count = Object.keys(snap.map ?? {}).length;
        log.info({ count, source: snap.source }, "SVF311 mirror_warm_ok");
      } catch (e) {
        log.warn({ err: String(e) }, "SVF315 mirror_warm_failed");
      }
    },
    onShutdown: async () => {
      await close();
    },
  });

  // Preferred path: BootableApp (AppBase implements boot()+instance)
  entry.run(
    () => app as unknown as { boot: () => Promise<void>; instance: any }
  );
}
