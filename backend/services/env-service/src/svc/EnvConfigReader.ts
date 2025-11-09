// backend/services/env-service/src/svc/EnvConfigReader.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version@level)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Single shared surface for reading EnvServiceDto from persistence.
 * - Used by:
 *   • env-service bootstrap (no HTTP hop)
 *   • GET /api/env-service/v1/... handlers (external callers)
 *
 * Invariants:
 * - Exactly one EnvServiceDto per (env, slug, version, level) enforced at DB via unique index.
 * - Returns a DtoBag for consistency (no naked DTOs cross this boundary).
 */

import type { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export type EnvConfigKey = {
  env: string;
  slug: string;
  version: number;
  level?: string;
};

export class EnvConfigReader {
  public constructor(private readonly dbReader: DbReader<EnvServiceDto>) {}

  /**
   * Load config for a specific (env, slug, version, level).
   *
   * Ops:
   * - If not found → throw with clear hint about seeding env-service.
   * - Duplicates are prevented by the unique index on (env, slug, version, level).
   */
  public async getConfigBag(key: EnvConfigKey): Promise<DtoBag<EnvServiceDto>> {
    const { env, slug, version } = key;
    const level = key.level ?? "service";

    const bag = await this.dbReader.readOneBag({
      filter: { env, slug, version, level },
    });

    // Generic emptiness check via iteration (no reliance on DtoBag internals).
    let hasItem = false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _dto of bag as unknown as Iterable<EnvServiceDto>) {
      hasItem = true;
      break;
    }

    if (!hasItem) {
      throw new Error(
        "ENV_CONFIG_NOT_FOUND: no env-service record for " +
          `env='${env}', slug='${slug}', version='${version}', level='${level}'. ` +
          "Ops: seed env-service with this document before starting env-service or dependents."
      );
    }

    return bag;
  }
}
