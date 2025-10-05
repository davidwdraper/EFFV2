// backend/services/gateway/src/services/svcconfig/LkgStore.ts
/**
 * Docs:
 * - SOP: Gateway keeps a Last-Known-Good (LKG) svcconfig mirror to survive facilitator outages.
 * - ADR-0012: Gateway SvcConfig (contract + LKG fallback)
 *
 * Purpose:
 * - Gateway-specific LKG store built on shared LkgStoreBase.
 * - Stores/loads the contract-clean mirror under the "mirror" key.
 *
 * Env:
 * - GATEWAY_SVCCONFIG_LKG_PATH  (optional) absolute or repo-root-relative JSON path
 *
 * Snapshot shape:
 * {
 *   "savedAt": "<ISO>",
 *   "mirror": {
 *     "<slug>@<version>": { ...ServiceConfigRecordJSON }
 *   }
 * }
 */

import type { ServiceConfigRecordJSON } from "@nv/shared/contracts/svcconfig.contract";
import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import { LkgStoreBase } from "@nv/shared/lkg/LkgStoreBase";

export type Mirror = Record<string, ServiceConfigRecordJSON>;

/**
 * Normalize unknown JSON into a canonical Mirror using the OO contract.
 * - Ensures keys match payload (`slug@version`)
 * - Lowercases slug via the contract rules
 * - Drops invalid entries by throwing (caller catches in tryLoad)
 */
function normalizeMirror(input: unknown): Mirror {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("mirror: expected object");
  }
  const out: Mirror = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const rec = new ServiceConfigRecord(v).toJSON();
    const key = svcKey(rec.slug, rec.version);
    if (k !== key) {
      throw new Error(
        `mirror key mismatch: file has "${k}" but payload is "${key}"`
      );
    }
    out[key] = rec;
  }
  return out;
}

/** Optional additional invariants (kept minimal for now). */
function validateMirror(m: Mirror): void {
  // Allow empty; gateway may start with zero services in some dev setups.
  for (const [k, rec] of Object.entries(m)) {
    if (!/^https?:\/\//.test(rec.baseUrl)) {
      throw new Error(`mirror invalid baseUrl for ${k}`);
    }
  }
}

/**
 * GatewaySvcConfigLkgStore
 * - Thin, typed facade around LkgStoreBase for svcconfig mirror.
 */
export class GatewaySvcConfigLkgStore extends LkgStoreBase<Mirror> {
  constructor(opts?: { path?: string }) {
    super({
      envVarName: opts?.path ? undefined : "GATEWAY_SVCCONFIG_LKG_PATH",
      defaultPath: opts?.path,
      wrapKey: "mirror",
      normalize: normalizeMirror,
      validate: validateMirror,
      logCtx: { slug: "gateway", version: 1, url: "/svcconfig/lkg" },
    });
  }

  /** Convenience alias consistent with our callers. */
  public loadMirror(): Mirror {
    return this.load();
  }
  public tryLoadMirror(): Mirror | null {
    return this.tryLoad();
  }
  public saveMirror(m: Mirror, meta?: Record<string, unknown>): void {
    this.save(m, meta);
  }
}
