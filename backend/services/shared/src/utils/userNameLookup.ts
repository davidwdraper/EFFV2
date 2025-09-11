import axios from "axios";
import { LRUCache } from "lru-cache";
import { logger } from "@shared/utils/logger";

// ---- ENV CONFIG ----
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || "http://localhost:4001";

// cache size + TTLs (bounded + configurable)
const CACHE_MAX = parseInt(process.env.USER_NAME_CACHE_MAX || "1000", 10); // entries
const CACHE_TTL = parseInt(process.env.USER_NAME_CACHE_TTL_MS || "300000", 10); // 5 min
const NEGATIVE_TTL = parseInt(
  process.env.USER_NAME_NEGATIVE_TTL_MS || "30000",
  10
); // 30s

// HTTP timeout for the lookup call
const HTTP_TIMEOUT_MS = parseInt(
  process.env.USER_NAME_HTTP_TIMEOUT_MS || "5000",
  10
);

// ---- LRU CACHE ----
const cache = new LRUCache<string, string>({
  max: CACHE_MAX,
  ttl: CACHE_TTL,
});

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
    const url = `${USER_SERVICE_URL}/users/public/names?ids=${encodeURIComponent(
      missing.join(",")
    )}`;
    const resp = await axios.get(url, { timeout: HTTP_TIMEOUT_MS });
    const names: Record<string, string> = resp.data?.names || {};

    // hydrate cache + merge
    for (const [id, name] of Object.entries(names)) {
      cache.set(id, name);
      result[id] = name;
    }

    // Soft negative cache for unknown IDs to avoid repeated hammering
    for (const id of missing) {
      if (result[id] === undefined) cache.set(id, "", { ttl: NEGATIVE_TTL });
    }

    return result;
  } catch (err: any) {
    logger.error(
      {
        err, // Pino recognizes `err` specially and logs stack, type, message
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
  out.createdByName = createdByName;
  out.ownedByName = ownedByName;

  logger.debug(
    `enrichWithUserNames - createdByName: ${out.createdByName}, ownedByName: ${out.ownedByName}`
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
