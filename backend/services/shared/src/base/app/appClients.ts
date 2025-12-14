// backend/services/shared/src/base/app/appClients.ts
/**
 * Docs:
 * - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 * - LDD-12 (SvcClient S2S contract)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Shared wiring for SvcClient and PromptsClient for AppBase.
 * - Centralizes env-aware construction; NO guessing, NO fallbacks.
 *
 * Invariants:
 * - No TTL fallback: NV_SVCCONFIG_CACHE_TTL_MS must be explicitly set to a valid integer.
 * - No implicit S2S mocking: when S2S_MOCKS is enabled, outbound S2S calls are blocked
 *   unless a deterministic test transport is injected elsewhere.
 */

import {
  SvcClient,
  type SvcTarget,
  type ISvcconfigResolver,
  type ISvcClientLogger,
} from "@nv/shared/s2s/SvcClient";
import { PromptsClient } from "@nv/shared/prompts/PromptsClient";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import { SvcconfigResolverWithCache } from "@nv/shared/s2s/SvcconfigResolverWithCache";

function requirePositiveIntEnv(name: string): number {
  const raw = process.env[name];
  const trimmed = typeof raw === "string" ? raw.trim() : "";

  if (!trimmed) {
    throw new Error(
      `${name}_MISSING: ${name} is required and must be a positive integer string. ` +
        `Ops: set ${name} explicitly (e.g., "5000") for this process.`
    );
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(
      `${name}_INVALID: ${name} must be a positive integer string; got "${raw}". ` +
        `Ops: correct ${name} in the environment for this process.`
    );
  }

  return n;
}

export function createSvcClientForApp(opts: {
  service: string;
  version: number;
  log: IBoundLogger;
  /**
   * Rails-provided flag (frozen at boot in AppBase).
   * When true, this factory wires a loud blocked transport via SvcClient.
   */
  s2sMocksEnabled: boolean;
}): SvcClient {
  const { service, version, log, s2sMocksEnabled } = opts;

  const loggerAdapter: ISvcClientLogger = {
    debug: (msg, meta) => log.debug(meta ?? {}, msg),
    info: (msg, meta) => log.info(meta ?? {}, msg),
    warn: (msg, meta) => log.warn(meta ?? {}, msg),
    error: (msg, meta) => log.error(meta ?? {}, msg),
  };

  let resolver: ISvcconfigResolver;

  // Required TTL. No fallbacks. Ever.
  const ttlMs = requirePositiveIntEnv("NV_SVCCONFIG_CACHE_TTL_MS");

  try {
    resolver = new SvcconfigResolverWithCache({
      logger: loggerAdapter,
      ttlMs,
    });

    log.info(
      { ttlMs },
      `[${service}] SvcClient: using svcconfig-backed resolver with TTL cache`
    );
  } catch (err) {
    const msg =
      `[${service}] SvcClient resolver not wired. ` +
      `Cannot resolve svcconfig targets; NV_SVCCONFIG_URL is likely missing. ` +
      "Ops: set NV_SVCCONFIG_URL for this process and ensure svcconfig is reachable.";
    log.error({ error: (err as Error)?.message }, msg);

    resolver = {
      async resolveTarget(
        env: string,
        slug: string,
        targetVersion: number
      ): Promise<SvcTarget> {
        throw new Error(
          `${msg} (env="${env}", slug="${slug}", version=${targetVersion})`
        );
      },
    };
  }

  return new SvcClient({
    callerSlug: service,
    callerVersion: version,
    logger: loggerAdapter,
    svcconfigResolver: resolver,
    requestIdProvider: () => `svcclient-${Date.now().toString(36)}`,
    tokenFactory: undefined,
    blockS2SReason: s2sMocksEnabled
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
