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
 */

import {
  SvcClient,
  type ISvcconfigResolver,
  type ISvcClientLogger,
  type ISvcClientTransport,
} from "@nv/shared/s2s/SvcClient";
import { PromptsClient } from "@nv/shared/prompts/PromptsClient";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import { SvcconfigResolverWithCache } from "@nv/shared/s2s/SvcconfigResolverWithCache";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

function requirePositiveIntVarFromDto(
  dto: EnvServiceDto,
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
  if (!trimmed) {
    throw new Error(
      `${name}_MISSING: ${name} is required and must be a positive integer string. ` +
        `Ops: set ${name} explicitly (e.g., "5000") in env-service for env="${dto.getEnvLabel()}".`
    );
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(
      `${name}_INVALID: ${name} must be a positive integer string; got "${raw}". ` +
        `Ops: correct ${name} in env-service for env="${dto.getEnvLabel()}".`
    );
  }

  return n;
}

function requireSvcconfigResolver(opts: {
  service: string;
  log: IBoundLogger;
  loggerAdapter: ISvcClientLogger;
  envDto: EnvServiceDto;
  ttlMs: number;
}): ISvcconfigResolver {
  const { service, log, loggerAdapter, envDto, ttlMs } = opts;

  // Fail-fast, but with useful Ops guidance.
  // If SvcconfigResolverWithCache throws, something fundamental is missing (usually NV_SVCCONFIG_URL).
  try {
    const resolver = new SvcconfigResolverWithCache({
      logger: loggerAdapter,
      ttlMs,
    });

    log.info(
      { ttlMs },
      `[${service}] SvcClient: using svcconfig-backed resolver with TTL cache`
    );

    return resolver;
  } catch (err) {
    // IMPORTANT: no fallback resolver. If we can't build the resolver, the service must not boot.
    // This avoids a “service looks up but can’t resolve targets” drift state.
    throw new Error(
      `SVCCONFIG_RESOLVER_INIT_FAILED: Failed to construct svcconfig resolver for service="${service}". ` +
        `Likely missing/invalid NV_SVCCONFIG_URL in env-service for env="${envDto.getEnvLabel()}". ` +
        'Ops: set NV_SVCCONFIG_URL (absolute URL, e.g., "http://localhost:4020") and ensure svcconfig is reachable. ' +
        `Detail: ${(err as Error)?.message ?? String(err)}`
    );
  }
}

export function createSvcClientForApp(opts: {
  service: string;
  version: number;
  log: IBoundLogger;
  envDto: EnvServiceDto;
  /**
   * Rails-provided flag (frozen at boot in AppBase).
   * When true, S2S calls are blocked UNLESS a deterministic transport is injected.
   */
  s2sMocksEnabled: boolean;

  /**
   * Optional deterministic transport (tests only).
   * When provided, this transport ALWAYS wins.
   */
  transport?: ISvcClientTransport;
}): SvcClient {
  const { service, version, log, envDto, s2sMocksEnabled, transport } = opts;

  const loggerAdapter: ISvcClientLogger = {
    debug: (msg, meta) => log.debug(meta ?? {}, msg),
    info: (msg, meta) => log.info(meta ?? {}, msg),
    warn: (msg, meta) => log.warn(meta ?? {}, msg),
    error: (msg, meta) => log.error(meta ?? {}, msg),
  };

  // Required TTL. No fallbacks. Ever.
  const ttlMs = requirePositiveIntVarFromDto(
    envDto,
    "NV_SVCCONFIG_CACHE_TTL_MS"
  );

  // Required resolver. No fallbacks. Ever.
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

    // Resolution order (do not change):
    // 1) explicit transport (tests)
    // 2) blocked transport when S2S_MOCKS=true
    // 3) default fetch transport
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
