// backend/services/svcfacilitator/src/loaders/mirror.loader.v2.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0038 — Authorization Hierarchy and Enforcement
 *
 * Purpose:
 * - Brand-new v2 mirror loader (temporary stub).
 * - Produces a normalized snapshot shape for a given { slug, version }.
 * - Returns meta with generatedAt + ttlSeconds; no env reads, no DB here (yet).
 *
 * Invariants:
 * - Single concern: build a snapshot object; no transport or caching here.
 * - Environment invariance: this file does not touch process.env.
 * - Fully wired: safe to use by app.v2.ts to exercise Mirror route + cache.
 *
 * Next step (planned):
 * - Replace stub body with real Mongo reads using v2 repos:
 *     ServiceConfigRepo.v2 and RoutePolicyRepo.v2
 * - Normalize via shared contracts:
 *     @nv/shared/contracts/service_configs.contract
 *     @nv/shared/contracts/route_policies.contract
 */

import type { MirrorSnapshot } from "../cache/MirrorStore.v2";

// ---- Snapshot Shape (opaque to the cache/controller; recommended structure) ----
export type MirrorSnapshotBodyV2 = {
  serviceConfig: {
    _id: string;
    slug: string;
    version: number;
    enabled: boolean;
    changedByUserId?: string; // ops visibility only
    updatedAt: string; // ISO
  };
  policies: {
    edge: Array<{
      _id: string;
      type: "Edge";
      method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
      path: string;
      bearerRequired: boolean;
      enabled: boolean;
      changedByUserId?: string; // ops visibility only
      updatedAt: string; // ISO
      slug: string;
      svcconfigId: string;
    }>;
    s2s: Array<{
      _id: string;
      type: "S2S";
      method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
      path: string;
      bearerRequired: boolean;
      enabled: boolean;
      allowedCallers?: string[];
      scopes?: string[];
      changedByUserId?: string; // ops visibility only
      updatedAt: string; // ISO
      slug: string;
      svcconfigId: string;
    }>;
  };
};

// ---- Loader (temporary stub) -------------------------------------------------

/**
 * Temporary loader that returns a minimal, self-consistent snapshot.
 * This allows us to wire the Mirror route + MirrorStore without touching DB.
 *
 * Contract with callers:
 * - meta.generatedAt: current ISO timestamp
 * - meta.ttlSeconds: positive integer; downstream gateway will respect remainder
 */
export async function mirrorLoaderV2(args: {
  slug: string;
  version: number;
}): Promise<MirrorSnapshot<MirrorSnapshotBodyV2>> {
  const { slug, version } = args;
  const nowIso = new Date().toISOString();

  // Minimal, normalized doc shapes
  const svcId = `svc_${slug}_${version}`;
  const serviceConfig = {
    _id: svcId,
    slug,
    version,
    enabled: true,
    updatedAt: nowIso,
    changedByUserId: "system", // ops-only; runtime logic never reads this
  };

  const policies = {
    edge: [
      {
        _id: `pol_${svcId}_health`,
        type: "Edge" as const,
        method: "GET" as const,
        path: "/health",
        bearerRequired: false,
        enabled: true,
        updatedAt: nowIso,
        changedByUserId: "system",
        slug,
        svcconfigId: svcId,
      },
    ],
    s2s: [
      // Intentionally empty by default; uncomment if you want a sample:
      // {
      //   _id: `pol_${svcId}_s2s_sample`,
      //   type: "S2S" as const,
      //   method: "GET" as const,
      //   path: "/v1/sample",
      //   bearerRequired: true,
      //   enabled: true,
      //   updatedAt: nowIso,
      //   changedByUserId: "system",
      //   slug,
      //   svcconfigId: svcId,
      //   allowedCallers: ["gateway"],
      //   scopes: ["read:sample"],
      // },
    ],
  };

  return {
    snapshot: { serviceConfig, policies },
    meta: {
      generatedAt: nowIso,
      ttlSeconds: 5, // keep in sync with MIRROR_TTL_MS in app.v2.ts (gateway uses remainder)
    },
  };
}
