// backend/services/shared/src/s2s/SvcconfigResolver.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - LDDs:
 *   - LDD-12 (SvcClient & S2S Contract Architecture)
 *   - LDD-16 / LDD-26 (svcconfig architecture)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0065 (Gateway v2 — svcconfig cache rails)
 *
 * Purpose:
 * - Concrete ISvcconfigResolver implementation backed by the svcconfig service
 *   and an in-process TTL cache of SvcconfigDto entries.
 *
 * Behavior:
 * - Key space: (env, slug, majorVersion) → SvcconfigDto.
 * - Cache: TTL per key; TTL is extended on each successful lookup.
 * - svcconfig service itself is special-cased to avoid recursion:
 *   • slug === "svcconfig" → baseUrl comes from NV_SVCCONFIG_URL.
 *
 * Notes:
 * - This resolver is SvcClient-specific; it is *not* the same resolver type
 *   used by routePolicyGate (which has its own contract).
 * - For normal targets:
 *   • `baseUrl` is taken **directly from SvcconfigDto.baseUrl`.
 *   • `targetPort` is still stored for gateway and ops, but SvcClient does
 *     not derive URLs from it.
 * - If a record lacks a usable baseUrl, we treat it as a misconfiguration
 *   and refuse to authorize the call (no "smart" defaults).
 */

import type {
  ISvcconfigResolver,
  ISvcClientLogger,
  SvcTarget,
} from "./SvcClient.types";
import { DtoCache } from "../dto/dtoCache";
import { DtoBag } from "../dto/DtoBag";
import { SvcconfigDto } from "../dto/svcconfig.dto";

type WireBagJson = {
  items?: unknown[];
  meta?: Record<string, unknown>;
};

type SvcconfigResolverOptions = {
  /**
   * Base protocol/host used for *worker* services.
   * - Example (dev): "http://127.0.0.1"
   * - Historically, port came from SvcconfigDto.targetPort.
   * - With baseUrl on SvcconfigDto, this is primarily used for:
   *   • svcconfig self-resolution (via NV_SVCCONFIG_URL), and
   *   • diagnostics / potential fallback logging.
   */
  workerBaseHost: string;
  /**
   * TTL (ms) for each svcconfig cache entry.
   * - Each successful lookup refreshes TTL.
   */
  ttlMs: number;
  /**
   * Logger compatible with ISvcClientLogger (typically the SvcClient logger adapter).
   */
  logger: ISvcClientLogger;
};

export class SvcconfigResolver implements ISvcconfigResolver {
  private readonly workerBaseHost: string;
  private readonly logger: ISvcClientLogger;
  private readonly cache: DtoCache<SvcconfigDto>;

  constructor(opts: SvcconfigResolverOptions) {
    this.workerBaseHost = opts.workerBaseHost.replace(/\/+$/, "");
    this.logger = opts.logger;

    this.cache = new DtoCache<SvcconfigDto>({
      ttlMs: opts.ttlMs,
      bagFactory: (dtos) => new DtoBag<SvcconfigDto>(dtos),
    });
  }

  /**
   * Resolve a SvcTarget using svcconfig + TTL cache.
   *
   * Special-case:
   * - slug === "svcconfig" → base URL comes from NV_SVCCONFIG_URL.
   */
  public async resolveTarget(
    env: string,
    slug: string,
    version: number
  ): Promise<SvcTarget> {
    // You can drop this debug once you’re happy:
    this.logger.error("******* svcconfig_resolver.resolve_target_called", {
      env,
      slug,
      version,
    });

    // Special-case svcconfig itself: use NV_SVCCONFIG_URL.
    if (slug === "svcconfig") {
      const raw = process.env.NV_SVCCONFIG_URL;
      const baseUrl = typeof raw === "string" ? raw.trim() : "";
      if (!baseUrl) {
        const msg =
          "SvcconfigResolver: NV_SVCCONFIG_URL is not set or empty. " +
          "Ops: set NV_SVCCONFIG_URL to the base URL for the svcconfig service " +
          '(e.g., "http://127.0.0.1:4002") so SvcClient can resolve svcconfig itself.';
        this.logger.error("svcconfig_resolver_svcconfig_url_missing", {
          env,
          slug,
          version,
          hint: msg,
        });
        throw new Error(msg);
      }

      return {
        baseUrl: baseUrl.replace(/\/+$/, ""),
        slug: "svcconfig",
        version,
        isAuthorized: true,
      };
    }

    const key = this.buildKey(env, slug, version);

    // 1) Cache hit path (refresh TTL)
    let bag = this.cache.getBag(key);
    if (bag) {
      // Extend TTL by re-putting the bag.
      this.cache.putBag(key, bag);
      const dto = this.pickSingleDto(bag, env, slug, version);
      return this.toSvcTarget(dto, env);
    }

    // 2) Cache miss: fetch from svcconfig service.
    const dto = await this.fetchFromSvcconfig(env, slug, version);
    bag = new DtoBag<SvcconfigDto>([dto]);
    this.cache.putBag(key, bag);

    return this.toSvcTarget(dto, env);
  }

  // ─────────────────────── Internal helpers ───────────────────────

  private buildKey(env: string, slug: string, version: number): string {
    return `${env}:${slug}:v${version}`;
  }

  /**
   * Pick the single SvcconfigDto from a bag.
   * - Today we expect at most one document per (env, slug, version).
   */
  private pickSingleDto(
    bag: DtoBag<SvcconfigDto>,
    env: string,
    slug: string,
    version: number
  ): SvcconfigDto {
    // Rely on DtoBag iteration; first DTO wins.
    for (const dto of bag as unknown as Iterable<SvcconfigDto>) {
      return dto;
    }

    const msg =
      "SvcconfigResolver: cache bag was empty for key that should exist. " +
      "Ops: verify svcconfig still has a record for this env/slug/version.";
    this.logger.error("svcconfig_resolver_empty_cached_bag", {
      env,
      slug,
      version,
      hint: msg,
    });
    throw new Error(msg);
  }

  /**
   * Call svcconfig's S2S route endpoint to locate the config entry for a given
   * (env, slug, majorVersion).
   *
   * Contract:
   * - GET /api/svcconfig/v1/svcconfig/s2s-route?env=&slug=&majorVersion=
   * - Returns a standard WireBagJson envelope with:
   *     items: [ SvcconfigJson ]  // exactly one item on success
   *
   * Invariants:
   * - 0 items → treated as "no config" and throws with Ops guidance.
   * - >1 items → treated as data corruption and throws loudly.
   */
  private async fetchFromSvcconfig(
    env: string,
    slug: string,
    version: number
  ): Promise<SvcconfigDto> {
    const svcconfigBase = this.getSvcconfigBaseUrl(env);
    const url =
      `${svcconfigBase}/api/svcconfig/v1/svcconfig/s2s-route` +
      `?env=${encodeURIComponent(env)}` +
      `&slug=${encodeURIComponent(slug)}` +
      `&majorVersion=${encodeURIComponent(String(version))}`;

    this.logger.debug("svcconfig_resolver.fetch.begin", {
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
      this.logger.error("svcconfig_resolver.fetch.non2xx", {
        env,
        slug,
        version,
        status: response.status,
        bodySnippet: bodyText.slice(0, 512),
      });

      throw new Error(
        `SvcconfigResolver: svcconfig s2s-route failed for env="${env}", slug="${slug}", version=${version}. ` +
          "Ops: check svcconfig logs and ensure its s2s-route endpoint is healthy."
      );
    }

    let parsed: WireBagJson;
    try {
      parsed = (bodyText ? JSON.parse(bodyText) : {}) as WireBagJson;
    } catch {
      this.logger.error("svcconfig_resolver.fetch.json_error", {
        env,
        slug,
        version,
        status: response.status,
        bodySnippet: bodyText.slice(0, 512),
      });
      throw new Error(
        "SvcconfigResolver: Failed to parse JSON from svcconfig s2s-route response. " +
          "Ops: verify svcconfig returns a standard WireBagJson envelope."
      );
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    if (items.length === 0) {
      const msg =
        "SvcconfigResolver: svcconfig returned no entries for env/slug/version on s2s-route lookup. " +
        "Ops: ensure a SvcconfigDto exists with matching env, slug, and majorVersion.";
      this.logger.warn("svcconfig_resolver.fetch.no_entries", {
        env,
        slug,
        version,
        hint: msg,
      });
      throw new Error(msg);
    }

    if (items.length > 1) {
      const msg =
        "SvcconfigResolver: svcconfig returned multiple entries for env/slug/version on s2s-route lookup. " +
        "Ops: there should be exactly one record per (env, slug, majorVersion); " +
        "resolve data duplication before restarting services.";
      this.logger.error("svcconfig_resolver.fetch.multiple_entries", {
        env,
        slug,
        version,
        count: items.length,
        hint: msg,
      });
      throw new Error(msg);
    }

    const dto = SvcconfigDto.fromBody(items[0], { validate: false });

    return dto;
  }

  /**
   * Compute the base URL for svcconfig itself.
   *
   * - Uses NV_SVCCONFIG_URL as the single source of truth.
   */
  private getSvcconfigBaseUrl(env: string): string {
    const raw = process.env.NV_SVCCONFIG_URL;
    const baseUrl = typeof raw === "string" ? raw.trim() : "";
    if (!baseUrl) {
      const msg =
        "SvcconfigResolver: NV_SVCCONFIG_URL is not set or empty. " +
        "Ops: set NV_SVCCONFIG_URL to the base URL for the svcconfig service " +
        '(e.g., "http://127.0.0.1:4002") so SvcClient can resolve target services.';
      this.logger.error("svcconfig_resolver.baseurl_missing", {
        env,
        hint: msg,
      });
      throw new Error(msg);
    }
    return baseUrl.replace(/\/+$/, "");
  }

  /**
   * Convert SvcconfigDto into a SvcTarget.
   *
   * Rules:
   * - If isEnabled=false or isS2STarget=false:
   *     • Do NOT authorize.
   *     • Still return a best-effort baseUrl for diagnostics (workerBaseHost + port),
   *       but SvcClient should see `isAuthorized=false` and refuse the call.
   * - Else:
   *     • Require a non-empty dto.baseUrl.
   *     • If baseUrl is blank/invalid, treat as misconfiguration and refuse to authorize.
   */
  private toSvcTarget(dto: SvcconfigDto, env: string): SvcTarget {
    const slug = dto.slug;
    const version = dto.majorVersion;
    const targetPort = dto.targetPort;
    const baseUrlFromDto = (dto.baseUrl ?? "").trim();

    const isEnabled = dto.isEnabled;
    const isS2S = dto.isS2STarget;

    // Helper for "diagnostic" base URL when we aren't actually authorizing.
    const diagnosticBaseUrl = `${this.workerBaseHost}:${targetPort || 0}`;

    if (!isEnabled || !isS2S) {
      const reasonParts: string[] = [];
      if (!isEnabled) reasonParts.push("isEnabled=false");
      if (!isS2S) reasonParts.push("isS2STarget=false");
      const reason = reasonParts.join(", ") || "Unknown";

      this.logger.warn("svcconfig_resolver.target_disabled", {
        env,
        slug,
        version,
        reason,
      });

      return {
        baseUrl: diagnosticBaseUrl,
        slug,
        version,
        isAuthorized: false,
        reasonIfNotAuthorized: reason,
      };
    }

    if (!baseUrlFromDto) {
      const reason =
        "SVCCONFIG_BASEURL_MISSING: svcconfig entry has no baseUrl for enabled S2S target.";
      this.logger.error("svcconfig_resolver.baseurl_missing_for_target", {
        env,
        slug,
        version,
        targetPort,
        hint: reason,
      });

      return {
        baseUrl: diagnosticBaseUrl,
        slug,
        version,
        isAuthorized: false,
        reasonIfNotAuthorized: "SVCCONFIG_BASEURL_MISSING",
      };
    }

    const baseUrl = baseUrlFromDto.replace(/\/+$/, "");

    this.logger.debug("svcconfig_resolver.target_resolved", {
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
}
