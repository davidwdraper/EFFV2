// backend/services/shared/src/base/app/appClients.ts
/**
 * Docs:
 * - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 * - LDD-12 (SvcClient S2S contract)
 *
 * Purpose:
 * - Shared wiring for SvcClient and PromptsClient for AppBase.
 */

import { SvcClient, type SvcTarget } from "@nv/shared/s2s/SvcClient";
import { PromptsClient } from "@nv/shared/prompts/PromptsClient";
import type { IBoundLogger } from "@nv/shared/logger/Logger";

export function createSvcClientForApp(opts: {
  service: string;
  version: number;
  log: IBoundLogger;
}): SvcClient {
  const { service, version, log } = opts;

  const svcconfigResolver = {
    // NOTE: this is intentionally a stub until svcconfig rails are wired.
    resolveTarget: async (
      env: string,
      slug: string,
      targetVersion: number
    ): Promise<SvcTarget> => {
      const msg =
        `[${service}] SvcClient resolver not wired. ` +
        `Cannot resolve target="${slug}@v${targetVersion}" in env="${env}". ` +
        "Ops: implement a svcconfig-backed resolver for this service before enabling S2S calls.";
      log.error({ env, slug, version: targetVersion }, msg);
      throw new Error(msg);
    },
  };

  return new SvcClient({
    callerSlug: service,
    callerVersion: version,
    logger: {
      debug: (msg, meta) => log.debug(meta ?? {}, msg),
      info: (msg, meta) => log.info(meta ?? {}, msg),
      warn: (msg, meta) => log.warn(meta ?? {}, msg),
      error: (msg, meta) => log.error(meta ?? {}, msg),
    },
    svcconfigResolver,
    requestIdProvider: () => `svcclient-${Date.now()}`,
    tokenFactory: undefined,
  });
}

export function createPromptsClientForApp(opts: {
  service: string;
  log: IBoundLogger;
  svcClient: SvcClient;
}): PromptsClient {
  const { service, log, svcClient } = opts;

  return new PromptsClient({
    logger: log,
    serviceSlug: service,
    svcClient,
    // requestId correlation can later be wired via per-request context.
    getRequestId: undefined,
  });
}
