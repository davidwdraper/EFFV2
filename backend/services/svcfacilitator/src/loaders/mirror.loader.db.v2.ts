// backend/services/svcfacilitator/src/loaders/mirror.loader.db.v2.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/loaders/mirror.loader.db.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0022 — Shared WAL & DB Base (RepoBase)
 *   - ADR-0038 — Authorization Hierarchy and Enforcement
 *
 * Purpose:
 * - Real, DB-backed mirror loader (v2).
 * - Reads `service_configs` and `route_policies` via v2 repos.
 * - Returns a fully normalized snapshot for { slug, version }.
 *
 * Invariants:
 * - Single concern: DB reads + composition; no caching here (MirrorStore handles that).
 * - Environment invariance: no env reads; TTL seconds are fixed here and enforced by caller TTL.
 * - No guessing: throws fast if the service config is missing/disabled.
 */

import type { MirrorSnapshot } from "../cache/MirrorStore.v2";
import type { MirrorSnapshotBodyV2 } from "./mirror.loader.v2";
import type { DbClient } from "@nv/shared/db/DbClient";
import { ServiceConfigRepoV2 } from "../repos/ServiceConfigRepo.v2";
import { RoutePolicyRepoV2 } from "../repos/RoutePolicyRepo.v2";

const DEFAULT_TTL_SECONDS = 5; // Keep aligned with MIRROR_TTL_MS in app.v2.ts (gateway uses remainder)

/** Normalize a Mongo-ish id (string or {$oid}) to a plain string. */
function normalizeId(id: unknown): string {
  if (typeof id === "string" && id.length > 0) return id;
  if (id && typeof id === "object" && "$oid" in (id as any)) {
    const v = (id as any)["$oid"];
    if (typeof v === "string" && v.length > 0) return v;
  }
  throw new Error("Invalid svcconfig _id format (expected string or {$oid})");
}

export interface MirrorLoaderDbDeps {
  db: DbClient;
}

/**
 * Factory that builds a DB-backed loader for use by MirrorController.v2.
 *
 * Usage:
 *   const loader = buildMirrorLoaderDbV2({ db });
 *   const snap = await loader({ slug: "gateway", version: 1 });
 */
export function buildMirrorLoaderDbV2({ db }: MirrorLoaderDbDeps) {
  const svcRepo = new ServiceConfigRepoV2(db);
  const polRepo = new RoutePolicyRepoV2(db);

  return async function mirrorLoaderDbV2(args: {
    slug: string;
    version: number;
  }): Promise<MirrorSnapshot<MirrorSnapshotBodyV2>> {
    const { slug, version } = args;

    // 1) Load service config (must exist & be enabled)
    const svc = await svcRepo.findEnabledBySlugVersion(slug, version);
    if (!svc) {
      // Fail fast — callers may choose to negative-cache this for a short TTL
      throw new Error(`No enabled service_config found for ${slug}@${version}`);
    }

    // 2) Load enabled route policies by svcconfigId
    const svcconfigId = normalizeId(svc._id);
    const policies = await polRepo.findEnabledGroupedBySvcconfigId(svcconfigId);

    // 3) Compose and return snapshot
    //    IMPORTANT: Your MirrorSnapshotBodyV2 expects a MINIMAL serviceConfig shape with `_id: string`.
    //    The contract JSON returns `_id?: unknown`, so we map to the expected subset and coerce `_id` to string.
    const nowIso = new Date().toISOString();

    const snapshot: MirrorSnapshotBodyV2 = {
      serviceConfig: {
        _id: svcconfigId,
        slug: svc.slug,
        version: svc.version,
        enabled: svc.enabled,
        updatedAt: svc.updatedAt,
        // If your MirrorSnapshotBodyV2 includes this optional ops field, keep it; otherwise remove it.
        changedByUserId: (svc as any).updatedBy ?? "system",
      },
      policies: {
        edge: policies.edge, // Strict types with `_id: string` guaranteed in the repo
        s2s: policies.s2s,
      },
    };

    return {
      snapshot,
      meta: {
        generatedAt: nowIso,
        ttlSeconds: DEFAULT_TTL_SECONDS,
      },
    };
  };
}
