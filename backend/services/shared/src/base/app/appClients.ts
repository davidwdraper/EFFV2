// backend/services/shared/src/base/app/appClients.ts
/**
 * Docs:
 * - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 * - LDD-12 (SvcClient S2S contract)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0082 (Infra Service Health Boot Check)
 *
 * Purpose:
 * - Shared wiring for SvcClient and PromptsClient for AppBase.
 * - Centralizes env-aware construction; NO guessing, NO fallbacks.
 *
 * Invariants:
 * - No TTL fallback: NV_SVCCONFIG_CACHE_TTL_MS must be explicitly set to a valid integer.
 * - No resolver fallback: if svcconfig resolver cannot be constructed, boot must fail fast.
 * - No implicit S2S mocking: when S2S_MOCKS is enabled, outbound S2S calls are blocked
 *   unless a deterministic test transport is explicitly injected.
 *
 * Boot invariant (critical):
 * - env-service resolution must NOT depend on svcconfig during boot.
 *   Otherwise all services deadlock trying to reach env-service through svcconfig.
 */

import {
  SvcClient,
  type ISvcconfigResolver,
  type ISvcClientLogger,
  type ISvcClientTransport,
  type SvcTarget,
} from "../../s2s/SvcClient";
import { PromptsClient } from "../../prompts/PromptsClient";
import type { IBoundLogger } from "../../logger/Logger";
import { SvcconfigResolverWithCache } from "../../s2s/SvcconfigResolverWithCache";
import { DbEnvServiceDto } from "../../dto/db.env-service.dto";

function requirePositiveIntVarFromDto(
  dto: DbEnvServiceDto,
  name: string
): number {
  let raw: string;
  try {
    raw = dto.getEnvVar(name);
  } catch (err) {
    throw new Error(
      `${name}_MISSING: ${name} is required and must be a positive integer string. ` +
        `Ops: set ${name} explicitly (e.g., "5000") in env-service for env="${dto.getEnvLabel()}". ` +
        `Detail: ${(err as Error)?.message ?? String(err)}`
    );
  }

  const trimmed = raw.trim();
  const n = Number(trimmed);

  if (!trimmed || !Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(
      `${name}_INVALID: ${name} must be a positive integer string; got "${raw}". ` +
        `Ops: correct ${name} in env-service for env="${dto.getEnvLabel()}".`
    );
  }

  return Math.trunc(n);
}

function requireAbsoluteUrlFromDto(dto: DbEnvServiceDto, name: string): string {
  let raw: string;
  try {
    raw = dto.getEnvVar(name);
  } catch (err) {
    throw new Error(
      `${name}_MISSING: ${name} is required and must be an absolute URL. ` +
        `Ops: set ${name} in env-service for env="${dto.getEnvLabel()}". ` +
        `Detail: ${(err as Error)?.message ?? String(err)}`
    );
  }

  const v = raw.trim();
  if (!v) {
    throw new Error(
      `${name}_MISSING: ${name} is required and must be an absolute URL. ` +
        `Ops: set ${name} in env-service for env="${dto.getEnvLabel()}".`
    );
  }

  try {
    // eslint-disable-next-line no-new
    new URL(v);
  } catch (err) {
    throw new Error(
      `${name}_INVALID: ${name} must be a valid absolute URL; got "${raw}". ` +
        `Ops: fix ${name} in env-service for env="${dto.getEnvLabel()}".`
    );
  }

  return v.replace(/\/+$/, "");
}

/**
 * Bootstrap resolver for env-service only.
 *
 * Reason:
 * - All services must be able to reach env-service *before* svcconfig is reachable.
 * - Therefore env-service resolution is anchored by NV_ENV_SERVICE_URL (origin) at boot.
 *
 * Env:
 * - NV_ENV_SERVICE_URL must be an ORIGIN (scheme + host + optional port), no path/query/hash.
 */
class BootstrapEnvServiceResolver implements ISvcconfigResolver {
  public async resolveTarget(
    _env: string,
    slug: string,
    version: number
  ): Promise<SvcTarget> {
    if (slug !== "env-service") {
      throw new Error(
        `BOOTSTRAP_ENV_RESOLVER_UNSUPPORTED: only supports slug="env-service". Got "${slug}@v${version}".`
      );
    }

    const raw = process.env.NV_ENV_SERVICE_URL;
    const rawBaseUrl = typeof raw === "string" ? raw.trim() : "";

    if (!rawBaseUrl) {
      throw new Error(
        "BOOTSTRAP_ENV_SERVICE_URL_MISSING: NV_ENV_SERVICE_URL is not set or empty. " +
          'Ops: set NV_ENV_SERVICE_URL to an ORIGIN like "http://127.0.0.1:4015".'
      );
    }

    let origin: string;
    try {
      const u = new URL(rawBaseUrl);

      const hasBadPath = u.pathname && u.pathname !== "/" && u.pathname !== "";
      const hasQuery = !!u.search;
      const hasHash = !!u.hash;

      if (hasBadPath || hasQuery || hasHash) {
        throw new Error(
          `NV_ENV_SERVICE_URL must be an ORIGIN only (no path/query/hash). Got "${rawBaseUrl}". ` +
            `Ops: set NV_ENV_SERVICE_URL to "${u.origin}".`
        );
      }

      origin = u.origin;
    } catch (e: any) {
      throw new Error(
        `BOOTSTRAP_ENV_SERVICE_URL_INVALID: NV_ENV_SERVICE_URL is invalid. Detail: ${
          (e as Error)?.message ?? String(e)
        }`
      );
    }

    return {
      baseUrl: origin,
      slug: "env-service",
      version,
      isAuthorized: true,
    };
  }
}

/** Composite resolver: env-service via bootstrap, everything else via svcconfig. */
class CompositeResolver implements ISvcconfigResolver {
  public constructor(
    private readonly envResolver: ISvcconfigResolver,
    private readonly svcconfigResolver: ISvcconfigResolver
  ) {}

  public async resolveTarget(
    env: string,
    slug: string,
    version: number
  ): Promise<SvcTarget> {
    if (slug === "env-service") {
      return await this.envResolver.resolveTarget(env, slug, version);
    }
    return await this.svcconfigResolver.resolveTarget(env, slug, version);
  }
}

function requireSvcconfigResolver(opts: {
  service: string;
  log: IBoundLogger;
  loggerAdapter: ISvcClientLogger;
  envDto: DbEnvServiceDto;
  ttlMs: number;
}): ISvcconfigResolver {
  const { service, log, loggerAdapter, envDto, ttlMs } = opts;

  try {
    const svcconfigBaseUrl = requireAbsoluteUrlFromDto(
      envDto,
      "NV_SVCCONFIG_URL"
    );

    const resolver = new SvcconfigResolverWithCache({
      logger: loggerAdapter,
      ttlMs,
      svcconfigBaseUrl,
    });

    log.info(
      { ttlMs },
      `[${service}] SvcClient: using svcconfig-backed resolver with TTL cache`
    );

    // Critical: env-service must not depend on svcconfig for resolution at boot.
    return new CompositeResolver(new BootstrapEnvServiceResolver(), resolver);
  } catch (err) {
    throw new Error(
      `SVCCONFIG_RESOLVER_INIT_FAILED: Failed to construct svcconfig resolver for service="${service}". ` +
        `Likely missing/invalid NV_SVCCONFIG_URL in env-service for env="${envDto.getEnvLabel()}". ` +
        'Ops: set NV_SVCCONFIG_URL (absolute URL, e.g., "http://127.0.0.1:4020") and ensure svcconfig is reachable. ' +
        `Detail: ${(err as Error)?.message ?? String(err)}`
    );
  }
}

export function createSvcClientForApp(opts: {
  service: string;
  version: number;
  log: IBoundLogger;
  envDto: DbEnvServiceDto;
  s2sMocksEnabled: boolean;
  transport?: ISvcClientTransport;
}): SvcClient {
  const { service, version, log, envDto, s2sMocksEnabled, transport } = opts;

  const loggerAdapter: ISvcClientLogger = {
    debug: (msg, meta) => log.debug(meta ?? {}, msg),
    info: (msg, meta) => log.info(meta ?? {}, msg),
    warn: (msg, meta) => log.warn(meta ?? {}, msg),
    error: (msg, meta) => log.error(meta ?? {}, msg),
  };

  const ttlMs = requirePositiveIntVarFromDto(
    envDto,
    "NV_SVCCONFIG_CACHE_TTL_MS"
  );

  const resolver = requireSvcconfigResolver({
    service,
    log,
    loggerAdapter,
    envDto,
    ttlMs,
  });

  return new SvcClient({
    callerSlug: service,
    callerVersion: version,
    logger: loggerAdapter,
    svcconfigResolver: resolver,
    requestIdProvider: () => `svcclient-${Date.now().toString(36)}`,

    transport,
    blockS2SReason:
      !transport && s2sMocksEnabled
        ? `S2S_MOCKS=true for service="${service}".`
        : undefined,
  });
}

export function createPromptsClientForApp(opts: {
  service: string;
  log: IBoundLogger;
  svcClient: SvcClient;
  getEnvLabel: () => string;
  getRequestId?: () => string;
}): PromptsClient {
  const { service, log, svcClient, getEnvLabel, getRequestId } = opts;

  return new PromptsClient({
    logger: log,
    serviceSlug: service,
    svcClient,
    getEnvLabel,
    getRequestId,
  });
}
