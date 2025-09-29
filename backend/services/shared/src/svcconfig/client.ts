// backend/services/shared/src/svcconfig/client.ts
/**
 * Docs:
 * - SOP:  docs/architecture/backend/SOP.md
 * - Arch: docs/architecture/backend/CONFIG.md
 * - ADRs:
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0035-ports-and-adapters-s2s-and-edge-jwt.md
 *
 * Purpose:
 * - Provide a **local mirror** of svcconfig for fast, side-effect-free reads at runtime.
 * - Expose a tiny API used across the fleet:
 *     getSvcconfigSnapshot() → { services } | null
 *     startSvcconfigMirror() → kicks a one-shot refresh (idempotent)
 *
 * Design Rules:
 * - ❌ No network I/O or env assertions at module import time.
 * - ✅ All network happens inside startSvcconfigMirror(), on demand only.
 * - ✅ Accepts multiple shapes from the authority and normalizes to `snapshot.services`.
 *
 * Notes:
 * - Authority base comes from SVCCONFIG_BASE_URL (read lazily). Path = /api/svcconfig.
 * - This mirror is **in-process only** (per-service). External persistence is out of scope.
 */

import { logger } from "../utils/logger";

type AnyRecord = Record<string, any>;

export type SvcconfigSnapshot = {
  /** Normalized map of service configs; accepts multiple upstream shapes. */
  services: AnyRecord;
  /** Diagnostics only. */
  received?: number;
  accepted?: number;
  /** ISO timestamp of the last successful refresh. */
  ts?: string;
};

let SNAPSHOT: SvcconfigSnapshot | null = null;
let _inFlight: Promise<void> | null = null;

/** Lightweight, late-bound env reader (no assertions at import). */
function env(name: string, dflt = ""): string {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "" ? v : dflt;
}

/** Build the authority URL lazily; default to loopback if unset. */
function authorityUrl(): URL {
  const base = env("SVCCONFIG_BASE_URL", "http://127.0.0.1:4002");
  const u = new URL(base);
  return new URL("/api/svcconfig", u);
}

/** Best-effort JSON parse with guardrails. */
async function parseJson(resp: Response): Promise<any> {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `[svcconfigClient] invalid JSON from authority (len=${text.length})`
    );
  }
}

/** Canonicalize version to 'V<n>' (e.g., 1|'1'|'v1' → 'V1'). */
function asVersionKey(x: unknown): string {
  const m = String(x ?? "1")
    .trim()
    .match(/^v?(\d+)$/i);
  return m ? `V${m[1]}` : String(x || "V1").toUpperCase();
}

/** Pull out payload under common wrappers: {data:{…}}, {services:{…}}, {items:[…]} */
function unwrap(payload: any): any {
  if (payload && typeof payload === "object" && payload.data) {
    payload = payload.data;
  }
  if (payload && typeof payload === "object" && payload.services) {
    return payload.services;
  }
  if (payload && typeof payload === "object" && Array.isArray(payload.items)) {
    return payload.items;
  }
  return payload;
}

/** Accept multiple upstream shapes, normalize to a single `services` object. */
function normalizeServices(raw: any): SvcconfigSnapshot {
  const payload = unwrap(raw);

  const out: AnyRecord = {};
  let received = 0;
  let accepted = 0;

  // Case A: Array of {slug, version, baseUrl, ...}
  if (Array.isArray(payload)) {
    received = payload.length;
    for (const item of payload) {
      const slug = String(item?.slug ?? "").toLowerCase();
      if (!slug) continue;
      const V = asVersionKey(item?.version ?? "V1"); // ← canonical 'Vn'
      const flatKey = `${slug}.${V}`.toLowerCase();

      // nested-by-version + flattened key
      out[slug] = out[slug] || {};
      out[slug][V] = item;
      out[flatKey] = item;
      accepted++;
    }
  }
  // Case B: Object keyed by slug or flattened keys
  else if (payload && typeof payload === "object") {
    const entries = Object.entries(payload as AnyRecord);
    received = entries.length;
    for (const [k, v] of entries) {
      // flattened key like "user.V1" or "user.v1" or "user.1"
      const m = /^([a-z0-9_-]+)\.(v?\d+)$/i.exec(k);
      if (m) {
        const slug = m[1].toLowerCase();
        const V = asVersionKey(m[2]);
        const flatKey = `${slug}.${V}`.toLowerCase();
        out[slug] = out[slug] || {};
        out[slug][V] = v;
        out[flatKey] = v;
        accepted++;
        continue;
      }
      // by slug — could be a direct cfg (has baseUrl) or a version map
      const slug = String(k || "").toLowerCase();
      if (!slug) continue;

      // If it looks like a version map, normalize its children keys to 'Vn'
      if (v && typeof v === "object" && !("baseUrl" in (v as any))) {
        const vm: AnyRecord = {};
        for (const [vk, vv] of Object.entries(v as AnyRecord)) {
          const V = asVersionKey(vk);
          vm[V] = vv;
          const flatKey = `${slug}.${V}`.toLowerCase();
          out[flatKey] = vv;
        }
        out[slug] = { ...(out[slug] || {}), ...vm };
      } else {
        // direct cfg under slug with implicit version (assume V1 if absent)
        const V = asVersionKey((v as any)?.version ?? "V1");
        out[slug] = out[slug] || {};
        out[slug][V] = v;
        const flatKey = `${slug}.${V}`.toLowerCase();
        out[flatKey] = v;
      }
      accepted++;
    }
  }

  return {
    services: out,
    received,
    accepted,
    ts: new Date().toISOString(),
  };
}

/** Return current in-memory snapshot (or null if not primed). */
export function getSvcconfigSnapshot(): SvcconfigSnapshot | null {
  return SNAPSHOT;
}

/**
 * Start (or refresh) the svcconfig mirror **once**. Idempotent, safe to call
 * concurrently; subsequent calls await the same in-flight refresh.
 *
 * Behavior:
 * - Single fetch from authority (no timers).
 * - **No Authorization header** in dev/local (avoids filtered results).
 * - On success: replace SNAPSHOT and log stats incl. slugs.
 * - On failure: warn; keep previous SNAPSHOT.
 */
export async function startSvcconfigMirror(): Promise<void> {
  if (_inFlight) {
    try {
      await _inFlight;
      return;
    } catch {
      // fall through to a fresh attempt
    }
  }

  _inFlight = (async () => {
    const url = authorityUrl();

    const ac = new AbortController();
    const timeoutMs = Number(env("SVCCONFIG_FETCH_TIMEOUT_MS", "1500")) || 1500;
    const t = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: ac.signal,
      });
      if (!resp.ok) {
        throw new Error(
          `[svcconfigClient] authority responded ${resp.status} ${resp.statusText}`
        );
      }

      const json = await parseJson(resp);
      const snap = normalizeServices(json);

      SNAPSHOT = snap;

      const slugs = Object.keys(snap.services)
        .filter((k) => !/\./.test(k))
        .sort();
      logger.info(
        {
          base: url.origin,
          path: url.pathname,
          received: snap.received ?? 0,
          accepted: snap.accepted ?? 0,
          slugs,
        },
        "[svcconfigClient] authority parse/transform stats"
      );
    } catch (err: any) {
      logger.warn(
        { err: String(err?.message || err), base: url.origin },
        "[svcconfigClient] authority fetch failed"
      );
    } finally {
      clearTimeout(t);
    }
  })();

  try {
    await _inFlight;
  } finally {
    _inFlight = null;
  }
}
