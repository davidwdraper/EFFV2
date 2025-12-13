// backend/services/shared/src/base/app/appClients.ts
/**
 * Docs:
 * - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 * - LDD-12 (SvcClient S2S contract)
 *
 * Purpose:
 * - Shared wiring for SvcClient and PromptsClient for AppBase.
 * - Centralizes env-aware construction; NO guessing, NO fallbacks.
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

export function createSvcClientForApp(opts: {
  service: string;
  version: number;
  log: IBoundLogger;
}): SvcClient {
  const { service, version, log } = opts;

  const loggerAdapter: ISvcClientLogger = {
    debug: (msg, meta) => log.debug(meta ?? {}, msg),
    info: (msg, meta) => log.info(meta ?? {}, msg),
    warn: (msg, meta) => log.warn(meta ?? {}, msg),
    error: (msg, meta) => log.error(meta ?? {}, msg),
  };

  let resolver: ISvcconfigResolver;

  // TTL from env, default 5 seconds if invalid/missing.
  const ttlRaw = process.env.NV_SVCCONFIG_CACHE_TTL_MS;
  const ttlParsed = ttlRaw ? Number(ttlRaw) : NaN;
  const ttlMs = Number.isFinite(ttlParsed) && ttlParsed > 0 ? ttlParsed : 5000;

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

    // Hard-error resolver — fail fast, loudly, always.
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
