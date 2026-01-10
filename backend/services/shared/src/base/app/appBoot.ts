// backend/services/shared/src/base/app/appBoot.ts
/**
 * Docs:
 * - SOP: DTO-first; fail-fast on index failures
 * - ADRs:
 *   - ADR-0044 (DbEnvServiceDto — EnvLike contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose:
 * - Centralized DB boot behavior for AppBase:
 *   • Skip index ensure for MOS / non-DB services.
 *   • Log registry snapshot when possible.
 *   • Ensure indexes via shared ensureIndexesForDtos(...) (fail-fast).
 *
 * Key invariant:
 * - Index ensure MUST receive boot context (service/envLabel/envDto/log),
 *   because env config is not read from process.env (ADR-0080).
 */

import type { DbEnvServiceDto } from "../../dto/db.env-service.dto";
import type { IDtoRegistry } from "../../registry/IDtoRegistry";
import type { IBoundLogger } from "../../logger/Logger";

import { ensureIndexesForDtos } from "../../dto/persistence/indexes/ensureIndexes";

export type DbBootContext = {
  service: string;
  component: string;
  envLabel: string;
  checkDb: boolean;
  envDto: DbEnvServiceDto;
  log: IBoundLogger;
  registry: IDtoRegistry;
};

export async function performDbBoot(ctx: DbBootContext): Promise<void> {
  const { service, component, envLabel, checkDb, log, registry, envDto } = ctx;

  if (!checkDb) {
    log.info(
      { service, component, env: envLabel },
      "boot: CHECK_DB=false — skipping registry diagnostics and index ensure (MOS, no DB required)"
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

  // 2) Ensure indexes via shared helper. On failure: log rich context, then rethrow (fail-fast).
  try {
    log.info(
      { service, component, env: envLabel },
      "boot: ensuring indexes via ensureIndexesForDtos(...)"
    );

    const listFn = (registry as any).listDbDtoCtorsForIndexes;
    if (typeof listFn !== "function") {
      throw new Error(
        `ENSURE_INDEXES_REGISTRY_LIST_MISSING: registry.listDbDtoCtorsForIndexes is not a function for service="${service}" component="${component}". ` +
          "Dev: implement listDbDtoCtorsForIndexes() on the concrete registry (DtoRegistry)."
      );
    }

    const dtos = listFn.call(registry);

    // DbEnvServiceDto is now aligned with ADR-0074 / ensureIndexesForDtos contract:
    // getDbVar(name): string (throws if missing/empty), DB_STATE-aware.
    await ensureIndexesForDtos({
      dtos,
      env: envDto,
      log,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    log.error(
      {
        service,
        component,
        env: envLabel,
        err: message,
        hint: "Index ensure failed. Ops: verify NV_MONGO_URI/NV_MONGO_DB in env-service config vars (and DB_STATE where required), DTO.indexHints[], and connectivity. Service will not start without indexes.",
      },
      "boot: ensureIndexes threw — aborting boot (fail-fast)"
    );
    throw err;
  }
}
