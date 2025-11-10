// backend/services/env-service/src/svc/EnvConfigReader.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *
 * Purpose:
 * - Unified helper for reading and merging EnvServiceDto configs.
 * - Used by both:
 *     • envBootstrap() (during service boot)
 *     • config pipeline handlers (HTTP GET /config)
 *
 * Invariants:
 * - Each (env, slug, version) yields at most one EnvServiceDto.
 * - No naked DTOs: always return DtoBag<EnvServiceDto>.
 * - mergeEnvBags() enforces single-item rule for both bags and merges vars deterministically.
 */

import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export type EnvConfigKey = {
  env: string;
  slug: string;
  version: number;
};

export class EnvConfigReader {
  /**
   * Fetch a DtoBag for the requested (env, slug, version).
   * Never throws on empty results — caller decides if that’s an error.
   */
  public static async getEnv(
    dbReader: DbReader<EnvServiceDto>,
    key: EnvConfigKey
  ): Promise<DtoBag<EnvServiceDto>> {
    const { env, slug, version } = key;
    return dbReader.readOneBag({ filter: { env, slug, version } });
  }

  /**
   * Merge two DtoBags (root + service) into one deterministic bag.
   *
   * Rules:
   * - If either bag has >1 dto → throw (index violation).
   * - If both empty → throw (no config at all).
   * - If one empty → return the other as-is.
   * - If both have 1 → patch root from service (service wins on collisions).
   */
  public static mergeEnvBags(
    rootBag?: DtoBag<EnvServiceDto>,
    serviceBag?: DtoBag<EnvServiceDto>
  ): DtoBag<EnvServiceDto> {
    const rootCount = rootBag?.count?.() ?? 0;
    const svcCount = serviceBag?.count?.() ?? 0;

    if (rootCount > 1 || svcCount > 1 || rootCount + svcCount === 0) {
      throw new Error(
        `ENV_CONFIG_INVALID_COUNT: root=${rootCount}, service=${svcCount}. ` +
          "Ops: ensure unique index (env, slug, version) and at least one valid config row."
      );
    }

    // Single-source configs
    if (rootCount === 0) return serviceBag!;
    if (svcCount === 0) return rootBag!;

    // Both present: merge service into root (service overrides).
    const rootDto = rootBag!.get(0);
    const svcDto = serviceBag!.get(0);

    rootDto.patchFromDto(svcDto);

    return new DtoBag<EnvServiceDto>([rootDto]);
  }
}
