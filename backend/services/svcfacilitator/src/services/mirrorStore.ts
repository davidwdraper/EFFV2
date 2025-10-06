// backend/services/svcfacilitator/src/services/mirrorStore.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *
 * Purpose:
 * - Hold the in-memory service-config mirror (canonical truth while running).
 * - Exposed via getter/setter used by boot.hydrate.ts and controllers.
 *
 * Behavior:
 * - Starts empty.
 * - `setMirror(m)` replaces the entire in-memory map.
 * - `getMirror()` returns the current snapshot ({} if none).
 */

import type { ServiceConfigMirror } from "@nv/shared/contracts/svcconfig.contract";

let _mirror: ServiceConfigMirror = {};

export const mirrorStore = {
  /** Replace the entire in-memory mirror */
  setMirror(mirror: ServiceConfigMirror): void {
    _mirror = mirror ?? {};
  },

  /** Return current in-memory mirror (empty object if unset) */
  getMirror(): ServiceConfigMirror {
    return _mirror ?? {};
  },

  /** For diagnostics only — count of records */
  count(): number {
    return Object.keys(_mirror ?? {}).length;
  },
};
