// backend/services/shared/src/base/app/appBoot.ts
/**
 * Docs:
 * - SOP: DTO-first
 * - ADRs:
 *   - ADR-0044 (DbEnvServiceDto — EnvLike contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0106 (Lazy index ensure via persistence IndexGate)
 *
 * Purpose:
 * - Centralized DB boot behavior for AppBase:
 *   • Skip DB boot behavior for MOS / non-DB services.
 *   • Log registry snapshot when possible.
 *
 * Key invariant (ADR-0106):
 * - Boot MUST NOT ensure MongoDB indexes.
 * - Index ensuring is enforced lazily at the persistence boundary (IndexGate).
 */

import type { DbEnvServiceDto } from "../../dto/db.env-service.dto";
import type { IDtoRegistry } from "../../registry/IDtoRegistry";
import type { IBoundLogger } from "../../logger/Logger";

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
  const { service, component, envLabel, checkDb, log, registry } = ctx;

  if (!checkDb) {
    log.info(
      { service, component, env: envLabel },
      "boot: CHECK_DB=false — skipping registry diagnostics (MOS, no DB required)"
    );
    return;
  }

  // Best-effort diagnostics only (no DB work here).
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
      "boot: registry.listRegistered() failed — continuing boot"
    );
  }
}
