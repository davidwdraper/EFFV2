// backend/services/svcfacilitator/src/services/MirrorLkgStore.ts
/**
 * Path: backend/services/svcfacilitator/src/services/MirrorLkgStore.ts
 * Design/ADR refs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0020: SvcConfig Mirror & Push Design
 * - ADR-0008: SvcFacilitator LKG — boot resilience when DB is down
 * - ADR-0007: SvcConfig Contract — fixed shapes & keys, OO form
 *
 * Why:
 * - Separate concerns: LKG persistence is handled by a reusable base (LkgStoreBase).
 * - This class binds the base to svcfacilitator’s mirror shape, env, and logging.
 * - Wrap key is "mirror" to preserve existing snapshot format.
 *
 * Notes:
 * - No console.* — uses shared structured logger via LkgStoreBase.
 * - Sync I/O by design (early-boot reliability). Atomic writes handled by base.
 */

import {
  ServiceConfigRecord,
  type ServiceConfigMirror,
} from "@nv/shared/contracts/svcconfig.contract";
import {
  LkgStoreBase,
  type LkgNormalizeFn,
  type LkgValidateFn,
} from "@nv/shared/lkg/LkgStoreBase";

const SLUG = "svcfacilitator";
const VERSION = 1;

const normalize: LkgNormalizeFn<ServiceConfigMirror> = (input) => {
  // Accept any plain object; coerce/validate via shared contract.
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    // Base will surface a nice error upstream if this throws.
    throw new Error("mirror payload is not an object");
  }
  return ServiceConfigRecord.parseMirror(input as Record<string, unknown>);
};

const validate: LkgValidateFn<ServiceConfigMirror> = (mirror) => {
  // Business invariants beyond schema (keep minimal):
  // - Keys should match "<slug>@<version>"
  // - Values already schema-checked by normalize()
  for (const key of Object.keys(mirror)) {
    if (!/^[a-z0-9\-]+@\d+$/.test(key)) {
      throw new Error(`invalid mirror key: ${key}`);
    }
  }
};

/**
 * MirrorLkgStore — typed LKG store for the facilitator's service-config mirror.
 */
export class MirrorLkgStore extends LkgStoreBase<ServiceConfigMirror> {
  constructor() {
    super({
      envVarName: "SVCCONFIG_LKG_PATH", // required by SOP/ADR-0008
      defaultPath: undefined, // require env; keeps behavior explicit
      wrapKey: "mirror", // preserve existing snapshot shape
      normalize,
      validate,
      logCtx: { slug: SLUG, version: VERSION, url: "/lkg/mirror" },
    });
  }
}
