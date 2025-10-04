// backend/services/gateway/src/services/svcconfig/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR0001 (Gateway-Embedded SvcConfig + Facilitator Mirror)
 *   - ADR0003 (Gateway pushes mirror to svcFacilitator)
 *
 * Purpose:
 * - Build and return the SvcConfig singleton.
 * - Wire the optional Facilitator Mirror Pusher without introducing type drift.
 *
 * Notes:
 * - Health and all proxied routes are VERSIONED now (v1, v2, ...).
 * - No silent fallback to v1: resolver must be passed an explicit version.
 */

import { SvcConfig } from "./SvcConfig";
import { SvcFacilitatorMirrorPusher } from "./SvcFacilitatorMirrorPusher";
import type { UrlResolver } from "@nv/shared";

let _instance: SvcConfig | null = null;

export function getSvcConfig(): SvcConfig {
  if (_instance) return _instance;

  // 1) Create the singleton
  _instance = new SvcConfig();

  // 2) Build the resolver expected by the pusher.
  //    UrlResolver allows version?: number, but our policy requires it.
  const resolver: UrlResolver = (slug, version) => {
    if (version == null) {
      throw new Error(
        `[svcconfig] Missing version for slug="${slug}". Expected /api/<slug>/v<major>/...`
      );
    }
    return _instance!.getUrlFromSlug(slug, version);
  };

  // 3) Construct the pusher and attach it to SvcConfig IF supported.
  //    (Guarded to avoid compile-time/type drift if SvcConfig has no setter.)
  const pusher = new SvcFacilitatorMirrorPusher(resolver);
  const instAny = _instance as unknown as {
    setMirrorPusher?: (p: SvcFacilitatorMirrorPusher) => void;
  };
  if (typeof instAny.setMirrorPusher === "function") {
    instAny.setMirrorPusher(pusher);
  }

  return _instance;
}

// Re-exports (keep stable)
export type { ServiceConfigRecord } from "@nv/shared/contracts/ServiceConfig";
export * from "./types";
