// backend/services/shared/src/utils/userNameLookup.ts
/**
 * NowVibin — userNameLookup
 *
 * Notes:
 * - Enforces SOP: **no fallbacks**. Required env must be present; fail fast.
 * - Drops external `lru-cache` dependency; uses a tiny local LRU.
 * - Keeps your public API (getUserNamesByIds, enrich*, invalidate) intact.
 */

import axios from "axios";
// If your logger lives at src/utils/logger.ts relative to this file, this import is correct.
// Adjust path only if your tree differs.
import { logger } from "../utils/logger";
import { requireUrl, requireNumber } from "../env";

// ---- ENV CONFIG (no fallbacks; fail fast) ----
const USER_SERVICE_URL = requireUrl("USER_SERVICE_URL");
const CACHE_MAX = requireNumber("USER_NAME_CACHE_MAX"); // entries
const CACHE_TTL = requireNumber("USER_NAME_CACHE_TTL_MS"); // ms
const NEGATIVE_TTL = requireNumber("USER_NAME_NEGATIVE_TTL_MS"); // ms
const HTTP_TIMEOUT_MS = requireNumber("USER_NAME_HTTP_TIMEOUT_MS"); // ms

// ---- Tiny LRU (bounded, TTL-aware by simple timestamp check on get) ----
type LruEntry<V> = { v: V; expiresAt: number };

class SimpleLRU<K, V> {
  private map = new Map<K, LruEntry<V>>();
  constructor(private max: number) {}

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    const now = Date.now();
    if (e.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    // bump recency
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }

  set(key: K, value: V, ttl: number): void {
    const expiresAt = Date.now() + Math.max(0, ttl | 0);
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      // Map is non-empty here by invariant (size >= max), so value is K
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
    this.map.set(key, { v: value, expiresAt });
  }

  delete(key: K): void {
    this.map.delete(key);
  }
}

const cache = new SimpleLRU<string, string>(CACHE_MAX);

// ---- PUBLIC API ----

/** Fetch display names for a set of userIds. Uses LRU cache + soft negative cache. */
export async function getUserNamesByIds(
  ids: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (unique.length === 0) return {};

  const result: Record<string, string> = {};
  const missing: string[] = [];

  // Serve what we can from cache first
  for (const id of unique) {
    const v = cache.get(id);
    if (v !== undefined) result[id] = v;
    else missing.push(id);
  }

  if (missing.length === 0) return result;

  try {
    const url = `${USER_SERVICE_URL.replace(
      /\/+$/,
      ""
    )}/users/public/names?ids=${encodeURIComponent(missing.join(","))}`;
    const resp = await axios.get(url, { timeout: HTTP_TIMEOUT_MS });
    const names: Record<string, string> = resp.data?.names || {};

    // hydrate cache + merge
    for (const [id, name] of Object.entries(names)) {
      cache.set(id, name, CACHE_TTL);
      result[id] = name;
    }

    // Soft negative cache for unknown IDs to avoid repeated hammering
    for (const id of missing) {
      if (result[id] === undefined) cache.set(id, "", NEGATIVE_TTL);
    }

    return result;
  } catch (err: any) {
    logger.error(
      {
        err,
        missingCount: missing.length,
      },
      "getUserNamesByIds failed"
    );
    // Return whatever we had from cache; don't throw
    return result;
  }
}

type BaseEntity = { userCreateId?: string; userOwnerId?: string };

export async function enrichWithUserNames<T extends BaseEntity>(
  entity: T,
  copy = true
): Promise<T & { createdByName?: string; ownedByName?: string }> {
  const ids = [entity.userCreateId, entity.userOwnerId].filter(
    Boolean
  ) as string[];
  if (ids.length === 0) return entity as any;

  const names = await getUserNamesByIds(ids);
  const createdByName = entity.userCreateId
    ? names[entity.userCreateId]
    : undefined;
  const ownedByName = entity.userOwnerId
    ? names[entity.userOwnerId]
    : undefined;

  const out = copy ? { ...(entity as any) } : (entity as any);
  (out as any).createdByName = createdByName;
  (out as any).ownedByName = ownedByName;

  logger.debug(
    `enrichWithUserNames - createdByName: ${createdByName}, ownedByName: ${ownedByName}`
  );
  return out;
}

export async function enrichManyWithUserNames<T extends BaseEntity>(
  entities: T[],
  copy = true
): Promise<(T & { createdByName?: string; ownedByName?: string })[]> {
  const idSet = new Set<string>();
  for (const e of entities) {
    if (e.userCreateId) idSet.add(e.userCreateId);
    if (e.userOwnerId) idSet.add(e.userOwnerId);
  }
  const names = await getUserNamesByIds(Array.from(idSet));

  return entities.map((e) => {
    const createdByName = e.userCreateId ? names[e.userCreateId] : undefined;
    const ownedByName = e.userOwnerId ? names[e.userOwnerId] : undefined;
    const out = copy ? { ...(e as any) } : (e as any);
    (out as any).createdByName = createdByName;
    (out as any).ownedByName = ownedByName;
    return out;
  });
}

/** Optional: call after a user profile update to refresh future lookups */
export function invalidateUserNameCache(userId: string) {
  if (!userId) return;
  cache.delete(userId);
}
