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
 * - Uses svcconfig’s own HTTP API:
 *     GET /api/svcconfig/v1/svcconfig/listAll?env=<env>
 *   to warm the cache by environment.
 *
 * Notes:
 * - Process-local only; **not** a distributed cache.
 * - Cache key: "env:slug:version".
 * - TTL is enforced per key; entries are "touched" (TTL reset) on successful reads.
 * - If NV_SVCCONFIG_URL is missing, construction fails fast (callers may catch and
 *   fall back to a stub, but gateway should treat this as fatal in real deployments).
 * - This resolver is intended for the gateway; it identifies itself to svcconfig
 *   via x-service-name: gateway so svcconfig can enforce gateway-specific filters.
 */

import { DtoBag } from "../dto/DtoBag";
import { SvcconfigDto } from "../dto/svcconfig.dto";
import { DtoCache, type DtoCacheKey } from "../dto/dtoCache";
import type {
  ISvcconfigResolver,
  ISvcClientLogger,
  SvcTarget,
} from "./SvcClient.types";

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
          "Ops: set NV_SVCCONFIG_URL to the base URL of svcconfig " +
          '(e.g., "http://127.0.0.1:4003") before enabling S2S calls.'
      );
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");

    this.cache = new DtoCache<SvcconfigDto>({
      ttlMs: this.ttlMs,
      // DtoBag has no static helpers; we just construct a new bag from the array.
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

    // 1) Attempt cache hit
    let bag = this.cache.getBag(key);

    // 2) On miss, warm the cache for this env, then retry
    if (!bag) {
      await this.warmEnv(env);
      bag = this.cache.getBag(key);
    }

    if (!bag) {
      this.log.warn("svcconfigResolver.miss.afterWarm", {
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

    const items = (bag as any).items?.() as Iterable<SvcconfigDto> | undefined;
    const dto = items ? first(items) : undefined;

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

    // "Touch" the entry to reset TTL based on access.
    this.cache.putBag(key, bag);

    if (!dto.isEnabled || !dto.isS2STarget) {
      const reason = !dto.isEnabled
        ? "SVCCONFIG_DISABLED"
        : "SVCCONFIG_NOT_S2S_TARGET";

      this.log.info("svcconfigResolver.deniedByConfig", {
        env,
        slug,
        version,
        reason,
      });

      return {
        baseUrl: "",
        slug,
        version,
        isAuthorized: false,
        reasonIfNotAuthorized: reason,
      };
    }

    const targetPort = dto.targetPort;
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

  // ────────────────────────────────────────────────────────────
  // Cache warm / HTTP against svcconfig
  // ────────────────────────────────────────────────────────────

  /**
   * Warm the cache for a given environment by calling:
   *   GET /api/svcconfig/v1/svcconfig/listAll?env=<env>
   *
   * This should be called:
   * - Lazily on first miss (always).
   * - Optionally from service boot for "warm at boot then fail-fast" semantics.
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

    // Populate cache: one key per (env, slug, majorVersion)
    for (const dto of dtos) {
      const dEnv = dto.env || env;
      const slug = dto.slug;
      const major = dto.majorVersion;

      if (!slug || !major) continue;

      const key = this.makeKey(dEnv, slug, major);
      const singleBag = new DtoBag<SvcconfigDto>([dto]);
      this.cache.putBag(key, singleBag);
    }

    this.log.info("svcconfigResolver.warmEnv.success", {
      env,
      count: dtos.length,
    });
  }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  private makeKey(env: string, slug: string, version: number): DtoCacheKey {
    return `${env}:${slug}:${version}`;
  }

  private parseBaseUrlHost(): { protocol: string; hostname: string } {
    try {
      const u = new URL(this.baseUrl);
      const protocol = u.protocol || "http:";
      const hostname = u.hostname || "127.0.0.1";
      return { protocol, hostname };
    } catch {
      // Fallback: treat baseUrl as "http://127.0.0.1"
      return { protocol: "http:", hostname: "127.0.0.1" };
    }
  }
}

/** First element helper for generic Iterables. */
function first<T>(it: Iterable<T>): T | undefined {
  for (const v of it) return v;
  return undefined;
}
