// backend/services/shared/src/utils/svcconfig/resolve.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Config: docs/architecture/backend/CONFIG.md
 * - SOP: docs/architecture/backend/SOP.md
 * - APRs:
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md  (APR-0029)
 *
 * Why:
 * - Resolve internal service base URLs strictly by (slug, version) from svcconfig LKG.
 * - No env overrides for URLs. No baked-in defaults. If required env is missing → throw.
 *
 * Resolution:
 *   - SVCCONFIG_BASE_URL + SVCCONFIG_LKG_PATH are required.
 *   - In-memory TTL cache only (TTL required via env).
 *
 * Returns:
 *   { baseUrl } without trailing slash.
 */

import axios from "axios";
// ⬇️ Fix: avoid self-import of @eff/shared inside shared; use relative path
import { requireUrl, requireEnv, requireNumber } from "../../env";

type SvcRecord = {
  slug: string;
  version: string;
  baseUrl: string;
  enabled?: boolean;
};
type Snapshot = { services?: Array<SvcRecord> | Record<string, SvcRecord> };
type CacheEntry = { baseUrl: string; expiresAt: number };

const SVCCONFIG_BASE_URL = requireUrl("SVCCONFIG_BASE_URL");
const SVCCONFIG_LKG_PATH = requireEnv("SVCCONFIG_LKG_PATH"); // e.g. "/svcconfig/lkg"
const CACHE_TTL_MS = requireNumber("SVCCONFIG_CACHE_TTL_MS"); // require explicit TTL (ms)

function trimSlash(s: string) {
  return s.replace(/\/+$/, "");
}
function joinBasePath(base: string, p: string) {
  const b = trimSlash(base);
  return p.startsWith("/") ? `${b}${p}` : `${b}/${p}`;
}
function normSlug(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase();
}
function normVersion(v: string) {
  const m = String(v || "")
    .trim()
    .match(/^v?(\d+)$/i);
  if (!m)
    throw new Error(
      `[svcconfig.resolve] invalid version "${v}" (expected "V1", "v2", "3")`
    );
  return `V${m[1]}`;
}

const cache = new Map<string, CacheEntry>(); // key = `${slug}@${version}`

async function fetchSnapshotStrict(): Promise<Snapshot> {
  const url = joinBasePath(SVCCONFIG_BASE_URL, SVCCONFIG_LKG_PATH);
  const { status, data } = await axios.get(url, {
    timeout: 1500,
    validateStatus: () => true,
  });
  if (status < 200 || status >= 300 || !data || typeof data !== "object") {
    throw new Error(
      `[svcconfig.resolve] LKG fetch failed (${status}) @ ${url}`
    );
  }
  return data as Snapshot;
}

/** Resolve internal base URL for (slug, version). Throws if not found or disabled. */
export async function resolveInternalBase(
  slug: string,
  version: string
): Promise<{ baseUrl: string }> {
  const s = normSlug(slug);
  const v = normVersion(version);
  const key = `${s}@${v}`;
  const now = Date.now();

  const c = cache.get(key);
  if (c && c.expiresAt > now) return { baseUrl: c.baseUrl };

  const snap = await fetchSnapshotStrict();
  const list = Array.isArray(snap.services)
    ? snap.services
    : Object.values(snap.services ?? {});
  const rec = list.find(
    (r) => normSlug(r.slug) === s && normVersion(r.version) === v
  );

  if (!rec || !rec.baseUrl) {
    throw new Error(
      `[svcconfig.resolve] not found: slug="${slug}" version="${version}" in LKG snapshot`
    );
  }
  if (rec.enabled === false) {
    throw new Error(
      `[svcconfig.resolve] disabled: slug="${slug}" version="${version}" (enabled=false)`
    );
  }

  const baseUrl = trimSlash(rec.baseUrl);
  cache.set(key, { baseUrl, expiresAt: now + CACHE_TTL_MS });
  return { baseUrl };
}
