// backend/services/gateway/src/clients/svcconfigClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route Policy via svcconfig
 *
 * Fetches & validates svcconfig (service + policy) for {slug, version}.
 * Caches by {slug:version} with cooldown.
 */

import {
  SvcConfigSchema,
  type SvcConfig,
} from "@eff/shared/src/contracts/svcconfig.contract";

const SVC_BASE = process.env.SVCCONFIG_BASE_URL;
const COOLDOWN = Number(process.env.SVC_POLICY_COOLDOWN_MS || "60000");

type Key = `${string}:${number}`;
type Entry = { cfg: SvcConfig; fetchedAt: number };

const cache = new Map<Key, Entry>();

function k(slug: string, version: number): Key {
  return `${slug}:${version}`;
}

export async function fetchSvcConfig(
  slug: string,
  version: number
): Promise<SvcConfig> {
  const key = k(slug, version);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < COOLDOWN) return hit.cfg;

  const url = `${SVC_BASE}/svcconfig/${encodeURIComponent(
    slug
  )}?version=${version}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `svcconfig fetch failed for ${slug}@v${version}: ${res.status}`
    );
  }
  const data = await res.json();
  const cfg = SvcConfigSchema.parse(data);

  cache.set(key, { cfg, fetchedAt: now });
  return cfg;
}
