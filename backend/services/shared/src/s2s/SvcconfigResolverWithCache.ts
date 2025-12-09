// backend/services/shared/src/s2s/SvcconfigResolverWithCache.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire format)
 *   - ADR-0065 (Gateway v2: SvcClient Proxy Rails & Svcconfig Cache)
 *
 * Purpose:
 * - svcconfig-backed ISvcconfigResolver implementation with an in-process TTL cache.
 * - Responsible for resolving (env, slug, majorVersion) → SvcTarget:
 *     baseUrl = "<scheme>://<host>:<targetPort>"
 *
 * Behavior:
 * - Cache key: "env:slug:version".
 * - TTL enforced per key; entries are "touched" (TTL reset) on successful reads.
 * - On cache miss, only the missing (env, slug, version) entry is fetched
 *   from svcconfig via the s2s-route endpoint; there is no full-env rewarm in
 *   the hot path.
 *
 * Notes:
 * - Process-local only; **not** a distributed cache.
 * - NV_SVCCONFIG_URL must point at the svcconfig service base URL
 *   (e.g., "http://127.0.0.1:4020").
 * - warmEnv() remains available for explicit boot-time preloads, but is never
 *   invoked from resolveTarget().
 */

import { DtoBag } from "../dto/DtoBag";
import { SvcconfigDto } from "../dto/svcconfig.dto";
import { DtoCache, type DtoCacheKey } from "../dto/dtoCache";
import type {
  ISvcconfigResolver,
  ISvcClientLogger,
  SvcTarget,
} from "./SvcClient.types";

type WireBagJson = {
  items?: unknown[];
  meta?: Record<string, unknown>;
};

type SvcconfigResolverOptions = {
  logger: ISvcClientLogger;
  /**
   * TTL in milliseconds for each entry.
   * Typical dev value: 5000–30000 ms.
   */
  ttlMs: number;
};

export class SvcconfigResolverWithCache implements ISvcconfigResolver {
  private readonly log: ISvcClientLogger;
  private readonly ttlMs: number;
  private readonly baseUrl: string; // base URL for the *svcconfig* service
  private readonly cache: DtoCache<SvcconfigDto>;

  constructor(opts: SvcconfigResolverOptions) {
    this.log = opts.logger;
    this.ttlMs = opts.ttlMs;

    const raw = process.env.NV_SVCCONFIG_URL;
    const baseUrl = typeof raw === "string" ? raw.trim() : "";

    if (!baseUrl) {
      throw new Error(
        "SvcconfigResolverWithCache: NV_SVCCONFIG_URL is not set or empty. " +
          'Ops: set NV_SVCCONFIG_URL to the base URL of svcconfig (e.g., "http://svcconfig.internal:4020") ' +
          "before enabling S2S calls."
      );
    }

    // Fail-fast if the URL is malformed; no localhost fallbacks.
    try {
      // Just to validate; we still store the trimmed string.
      // Any malformed value should abort boot.
      // eslint-disable-next-line no-new
      new URL(baseUrl);
    } catch (err) {
      const msg =
        "SvcconfigResolverWithCache: NV_SVCCONFIG_URL is not a valid absolute URL. " +
        'Ops: set NV_SVCCONFIG_URL to a full base URL for svcconfig (e.g., "http://svcconfig.internal:4020").';
      this.log.error("svcconfigResolver.invalidNvSvcconfigUrl", {
        baseUrl,
        error: err instanceof Error ? err.message : String(err),
        hint: msg,
      });
      throw new Error(msg);
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");

    this.cache = new DtoCache<SvcconfigDto>({
      ttlMs: this.ttlMs,
      bagFactory: (dtos) => new DtoBag<SvcconfigDto>(dtos),
    });
  }

  // ────────────────────────────────────────────────────────────
  // ISvcconfigResolver
  // ────────────────────────────────────────────────────────────

  public async resolveTarget(
    env: string,
    slug: string,
    version: number
  ): Promise<SvcTarget> {
    const key = this.makeKey(env, slug, version);

    // 1) First attempt: read from cache
    let bag = this.readFromCache(key);

    // 2) On miss: load just this key from svcconfig, then re-read cache
    if (!bag) {
      this.log.debug("svcconfigResolver.cacheMiss", { env, slug, version });

      const dto = await this.loadCacheItemFromSvcconfig(env, slug, version);

      if (!dto) {
        this.log.warn("svcconfigResolver.miss.afterSingleFetch", {
          env,
          slug,
          version,
        });

        return {
          baseUrl: "",
          slug,
          version,
          isAuthorized: false,
          reasonIfNotAuthorized: "SVCCONFIG_NOT_FOUND",
        };
      }

      // Re-read from cache to follow the explicit flow:
      //   readFromCache → loadCacheItem → readFromCache
      bag = this.readFromCache(key);

      if (!bag) {
        // Extremely defensive: we *just* put it; if we still can't see it,
        // fall back to dto → SvcTarget without cache.
        this.log.error("svcconfigResolver.cachePutOrReadFailed", {
          env,
          slug,
          version,
        });

        return this.toSvcTarget(dto, env);
      }
    }

    const dto = this.pickSingleDtoFromBag(bag, env, slug, version);
    if (!dto) {
      this.log.warn("svcconfigResolver.emptyBag", {
        env,
        slug,
        version,
      });

      return {
        baseUrl: "",
        slug,
        version,
        isAuthorized: false,
        reasonIfNotAuthorized: "SVCCONFIG_EMPTY_BAG",
      };
    }

    // 3) Touch entry to reset TTL
    this.cache.putBag(key, bag);

    return this.toSvcTarget(dto, env);
  }

  // ────────────────────────────────────────────────────────────
  // Cache warm / HTTP against svcconfig
  // ────────────────────────────────────────────────────────────

  /**
   * Warm the cache for a given environment by calling:
   *   GET /api/svcconfig/v1/svcconfig/listAll?env=<env>
   *
   * Intended for boot-time / ops-triggered warmups on the gateway.
   * NOT used from resolveTarget().
   */
  public async warmEnv(env: string): Promise<void> {
    const url = `${
      this.baseUrl
    }/api/svcconfig/v1/svcconfig/listAll?env=${encodeURIComponent(env)}`;

    this.log.info("svcconfigResolver.warmEnv.begin", { env, url });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        // Identify the caller so svcconfig listAll can apply gateway-specific filters.
        "x-service-name": "gateway",
      },
    });

    const bodyText = await response.text();

    if (!response.ok) {
      this.log.error("svcconfigResolver.warmEnv.httpError", {
        env,
        status: response.status,
        bodySnippet: bodyText.slice(0, 512),
      });
      throw new Error(
        `svcconfigResolver.warmEnv failed for env="${env}" (status=${response.status}).`
      );
    }

    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : {};
    } catch (err) {
      this.log.error("svcconfigResolver.warmEnv.parseError", {
        env,
        error: (err as Error)?.message,
        bodySnippet: bodyText.slice(0, 512),
      });
      throw new Error(
        `svcconfigResolver.warmEnv: invalid JSON from svcconfig for env="${env}".`
      );
    }

    const items = Array.isArray((parsed as any).items)
      ? ((parsed as any).items as unknown[])
      : [];

    const dtos: SvcconfigDto[] = items.map((j) =>
      SvcconfigDto.fromBody(j, { validate: false })
    );

    for (const dto of dtos) {
      const dEnv = dto.env || env;
      const dSlug = dto.slug;
      const major = dto.majorVersion;

      if (!dSlug || !major) continue;

      const key = this.makeKey(dEnv, dSlug, major);
      const singleBag = new DtoBag<SvcconfigDto>([dto]);
      this.cache.putBag(key, singleBag);
    }

    this.log.info("svcconfigResolver.warmEnv.success", {
      env,
      count: dtos.length,
    });
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  private makeKey(env: string, slug: string, version: number): DtoCacheKey {
    return `${env}:${slug}:${version}`;
  }

  private readFromCache(key: DtoCacheKey): DtoBag<SvcconfigDto> | undefined {
    const bag = this.cache.getBag(key);
    return bag ?? undefined; // normalize null → undefined
  }

  /**
   * Single-key load from svcconfig:
   *   GET /api/svcconfig/v1/svcconfig/s2s-route?env=&slug=&majorVersion=
   *
   * On success:
   * - Puts the resulting SvcconfigDto into the cache under its (env, slug, majorVersion) key.
   * - Returns the DTO.
   *
   * On "no rows" it returns undefined; callers treat that as NOT_FOUND.
   */
  private async loadCacheItemFromSvcconfig(
    env: string,
    slug: string,
    version: number
  ): Promise<SvcconfigDto | undefined> {
    const url =
      `${this.baseUrl}/api/svcconfig/v1/svcconfig/s2s-route` +
      `?env=${encodeURIComponent(env)}` +
      `&slug=${encodeURIComponent(slug)}` +
      `&majorVersion=${encodeURIComponent(String(version))}`;

    this.log.debug("svcconfigResolver.singleFetch.begin", {
      env,
      slug,
      version,
      url,
    });

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    const bodyText = await response.text();

    if (!response.ok) {
      this.log.error("svcconfigResolver.singleFetch.httpError", {
        env,
        slug,
        version,
        status: response.status,
        bodySnippet: bodyText.slice(0, 512),
      });

      throw new Error(
        `SvcconfigResolverWithCache: s2s-route failed for env="${env}", slug="${slug}", version=${version}.`
      );
    }

    let parsed: WireBagJson;
    try {
      parsed = (bodyText ? JSON.parse(bodyText) : {}) as WireBagJson;
    } catch (err) {
      this.log.error("svcconfigResolver.singleFetch.parseError", {
        env,
        slug,
        version,
        error: (err as Error)?.message,
        bodySnippet: bodyText.slice(0, 512),
      });
      throw new Error(
        "SvcconfigResolverWithCache: invalid JSON from svcconfig s2s-route response."
      );
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];

    if (items.length === 0) {
      this.log.warn("svcconfigResolver.singleFetch.noEntry", {
        env,
        slug,
        version,
      });
      return undefined;
    }

    if (items.length > 1) {
      this.log.error("svcconfigResolver.singleFetch.multipleEntries", {
        env,
        slug,
        version,
        count: items.length,
      });
      throw new Error(
        "SvcconfigResolverWithCache: svcconfig returned multiple entries for env/slug/majorVersion; expected exactly one."
      );
    }

    const dto = SvcconfigDto.fromBody(items[0], { validate: false });

    const dEnv = dto.env || env;
    const dSlug = dto.slug;
    const major = dto.majorVersion;

    if (!dSlug || !major) {
      this.log.error("svcconfigResolver.singleFetch.malformedDto", {
        env,
        slug,
        version,
        dtoEnv: dEnv,
        dtoSlug: dSlug,
        dtoVersion: major,
      });
      return undefined;
    }

    const key = this.makeKey(dEnv, dSlug, major);
    const bag = new DtoBag<SvcconfigDto>([dto]);
    this.cache.putBag(key, bag);

    this.log.debug("svcconfigResolver.singleFetch.cached", {
      env: dEnv,
      slug: dSlug,
      version: major,
      key,
    });

    return dto;
  }

  private pickSingleDtoFromBag(
    bag: DtoBag<SvcconfigDto>,
    env: string,
    slug: string,
    version: number
  ): SvcconfigDto | undefined {
    for (const dto of bag as unknown as Iterable<SvcconfigDto>) {
      return dto;
    }

    this.log.error("svcconfigResolver.emptyCachedBag", {
      env,
      slug,
      version,
    });

    return undefined;
  }

  /**
   * Convert SvcconfigDto into a SvcTarget with:
   * - baseUrl: protocol/host derived strictly from NV_SVCCONFIG_URL; port from targetPort.
   * - isAuthorized: based on isEnabled + isS2STarget.
   *
   * Any malformed NV_SVCCONFIG_URL will have already caused a hard failure
   * in the constructor or here via parseBaseUrlHost().
   */
  private toSvcTarget(dto: SvcconfigDto, env: string): SvcTarget {
    const slug = dto.slug;
    const version = dto.majorVersion;
    const targetPort = dto.targetPort;

    const isEnabled = dto.isEnabled;
    const isS2S = dto.isS2STarget;

    if (!Number.isFinite(targetPort) || targetPort <= 0) {
      this.log.error("svcconfigResolver.invalidPort", {
        env,
        slug,
        version,
        targetPort,
      });

      return {
        baseUrl: "",
        slug,
        version,
        isAuthorized: false,
        reasonIfNotAuthorized: "SVCCONFIG_INVALID_PORT",
      };
    }

    const { protocol, hostname } = this.parseBaseUrlHost();

    if (!isEnabled || !isS2S) {
      const reason = !isEnabled
        ? "SVCCONFIG_DISABLED"
        : "SVCCONFIG_NOT_S2S_TARGET";

      this.log.info("svcconfigResolver.deniedByConfig", {
        env,
        slug,
        version,
        reason,
      });

      return {
        baseUrl: `${protocol}//${hostname}:${targetPort}`,
        slug,
        version,
        isAuthorized: false,
        reasonIfNotAuthorized: reason,
      };
    }

    const baseUrl = `${protocol}//${hostname}:${targetPort}`;

    this.log.debug("svcconfigResolver.resolved", {
      env,
      slug,
      version,
      baseUrl,
      targetPort,
    });

    return {
      baseUrl,
      slug,
      version,
      isAuthorized: true,
    };
  }

  /**
   * Strictly parse NV_SVCCONFIG_URL to derive protocol/hostname.
   *
   * Invariants:
   * - No fallbacks to 127.0.0.1 or "http:".
   * - Any malformed value is treated as a fatal configuration error.
   */
  private parseBaseUrlHost(): { protocol: string; hostname: string } {
    try {
      const u = new URL(this.baseUrl);
      const protocol = u.protocol;
      const hostname = u.hostname;

      if (!protocol || !hostname) {
        const msg =
          "SvcconfigResolverWithCache: NV_SVCCONFIG_URL is malformed; missing protocol or hostname. " +
          'Ops: set NV_SVCCONFIG_URL to a full base URL for svcconfig (e.g., "http://svcconfig.internal:4020").';
        this.log.error("svcconfigResolver.invalidBaseUrl_components", {
          baseUrl: this.baseUrl,
          protocol,
          hostname,
          hint: msg,
        });
        throw new Error(msg);
      }

      return { protocol, hostname };
    } catch (err) {
      const msg =
        "SvcconfigResolverWithCache: NV_SVCCONFIG_URL is not a valid absolute URL. " +
        'Ops: set NV_SVCCONFIG_URL to a full base URL for svcconfig (e.g., "http://svcconfig.internal:4020").';
      this.log.error("svcconfigResolver.invalidBaseUrl", {
        baseUrl: this.baseUrl,
        error: err instanceof Error ? err.message : String(err),
        hint: msg,
      });
      throw new Error(msg);
    }
  }
}

/** First element helper for generic Iterables. */
function first<T>(it: Iterable<T>): T | undefined {
  for (const v of it) return v;
  return undefined;
}
