// backend/services/shared/src/base/app/appBoot.ts
/**
 * Docs:
 * - SOP: DTO-first; fail-fast on index failures
 * - ADRs:
 *   - ADR-0044 (EnvServiceDto — EnvLike contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose:
 * - Centralized DB boot behavior for AppBase:
 *   • Skip index ensure for MOS / non-DB services.
 *   • Log registry snapshot when possible.
 *   • Ensure indexes via registry.ensureIndexes().
 */

import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import type { IBoundLogger } from "@nv/shared/logger/Logger";

export type DbBootContext = {
  service: string;
  component: string;
  envLabel: string;
  checkDb: boolean;
  envDto: EnvServiceDto;
  log: IBoundLogger;
  registry: IDtoRegistry;
};

export async function performDbBoot(ctx: DbBootContext): Promise<void> {
  const { service, component, envLabel, checkDb, envDto, log, registry } = ctx;

  if (!checkDb) {
    log.info(
      { service, component, env: envLabel },
      "boot: CHECK_DB=false — skipping registry.listRegistered() and registry.ensureIndexes() (MOS, no DB required)"
    );
    return;
  }

  // 1) Best-effort diagnostics
  try {
    const listFn = (registry as any).listRegistered;
    if (typeof listFn === "function") {
      const listed = listFn.call(registry); // [{ type, collection }]
      log.info(
        { registry: listed, env: envLabel },
        "boot: registry listRegistered() — types & collections"
      );
    }
  } catch (err) {
    log.warn(
      { err: (err as Error)?.message, env: envLabel },
      "boot: registry.listRegistered() failed — continuing to index ensure"
    );
  }

  // 2) Ensure indexes via Registry. On failure: log rich context, then rethrow (fail-fast).
  try {
    log.info(
      { service, component, env: envLabel },
      "boot: ensuring indexes via registry.ensureIndexes()"
    );
    await (registry as any).ensureIndexes(envDto, log);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    log.error(
      {
        service,
        component,
        env: envLabel,
        err: message,
        hint: "Index ensure failed. Ops: verify NV_MONGO_URI/NV_MONGO_DB in env-service config, DTO.indexHints[], and connectivity. Service will not start without indexes.",
      },
      "boot: ensureIndexes threw — aborting boot (fail-fast)"
    );
    throw err;
  }
}
