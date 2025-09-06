// backend/services/gateway-core/src/svcconfig/state.ts
import type { ServiceConfig } from "@shared/contracts/svcconfig.contract";

export type SvcconfigSnapshot = {
  version: string; // from edge gateway ETag payload "v:<version>" (we store just <version>)
  updatedAt: number; // epoch ms
  services: Record<string, ServiceConfig>;
};

export type Source = "cache" | "lkg" | "empty";

type State = {
  source: Source;
  etag: string | null; // full ETag as received (e.g., `"v:42"`)
  snapshot: SvcconfigSnapshot | null;
  lastFetchMs: number; // epoch ms we last attempted any fetch
};

const STATE: State = {
  source: "empty",
  etag: null,
  snapshot: null,
  lastFetchMs: 0,
};

export function setFromNetwork(snapshot: SvcconfigSnapshot, etag: string) {
  STATE.snapshot = snapshot;
  STATE.etag = etag;
  STATE.source = "cache";
  STATE.lastFetchMs = Date.now();
}

export function setFromLkg(
  snapshot: SvcconfigSnapshot | null,
  etag?: string | null
) {
  STATE.snapshot = snapshot;
  STATE.etag = etag ?? STATE.etag;
  STATE.source = snapshot ? "lkg" : "empty";
  STATE.lastFetchMs = Date.now();
}

export function getEtag(): string | null {
  return STATE.etag;
}

export function getSnapshot(): SvcconfigSnapshot | null {
  return STATE.snapshot;
}

/** Readiness-style probe for health endpoint consumption */
export function getReadiness() {
  const snap = STATE.snapshot;
  const now = Date.now();
  const ageMs = snap ? now - snap.updatedAt : Number.POSITIVE_INFINITY;
  return {
    ok: !!snap,
    source: STATE.source as Source,
    version: snap?.version ?? null,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    services: snap ? Object.keys(snap.services) : [],
  };
}
