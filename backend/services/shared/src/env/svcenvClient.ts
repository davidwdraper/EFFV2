// backend/services/shared/src/env/svcenvClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env) [carried via env-service]
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *
 * Purpose:
 * - Thin, strongly-typed client for env-service.
 *
 * Invariants:
 * - No direct DTO construction.
 * - No direct DbEnvServiceDto.fromBody() calls.
 * - All hydration flows through registry.create(dtoKey, body, { validate, mode }).
 */

import { DtoBag } from "../dto/DtoBag";
import { DbEnvServiceDto } from "../dto/db.env-service.dto";
import { SvcClient, type WireBagJson } from "../s2s/SvcClient";
import type { IDtoRegistry } from "../registry/IDtoRegistry";

export type SvcEnvClientConfig = {
  svcClient: SvcClient;
  registry: IDtoRegistry;

  /**
   * Target env-service slugKey. Default "env-service@1".
   * Format: "<slug>@<version>" (e.g., "env-service@1").
   */
  envServiceSlugKey?: string;
};

export type GetCurrentEnvArgs = {
  slug: string;
  version: number;
};

export type GetConfigArgs = {
  env: string;
  slug: string;
  version: number;
};

export class SvcEnvClient {
  private readonly svcClient: SvcClient;
  private readonly registry: IDtoRegistry;

  private readonly envServiceSlug: string;
  private readonly envServiceVersion: number;

  constructor(cfg: SvcEnvClientConfig) {
    this.svcClient = cfg.svcClient;
    this.registry = cfg.registry;

    const slugKey = cfg.envServiceSlugKey?.trim() || "env-service@1";
    const [slugPart, versionPart] = slugKey.split("@");

    this.envServiceSlug =
      slugPart && slugPart.trim().length > 0 ? slugPart.trim() : "env-service";

    const fallbackVersion = 1;
    const parsed = versionPart
      ? parseInt(versionPart.trim(), 10)
      : fallbackVersion;
    this.envServiceVersion =
      Number.isNaN(parsed) || parsed <= 0 ? fallbackVersion : parsed;
  }

  public async getCurrentEnv(_args: GetCurrentEnvArgs): Promise<string> {
    const raw = process.env.NV_ENV;
    const env = typeof raw === "string" ? raw.trim() : "";

    if (!env) {
      throw new Error(
        "SVCENV_CURRENT_ENV_MISSING: NV_ENV is not set or empty. " +
          "Ops: set NV_ENV (e.g., 'dev', 'stage', 'prod') before starting the process."
      );
    }

    return env;
  }

  public async getConfig(
    args: GetConfigArgs
  ): Promise<DtoBag<DbEnvServiceDto>> {
    const { env, slug: targetServiceSlug, version } = args;

    const query =
      `env=${encodeURIComponent(env)}` +
      `&slug=${encodeURIComponent(targetServiceSlug)}` +
      `&version=${encodeURIComponent(String(version))}`;

    let wire: WireBagJson;
    try {
      wire = await this.svcClient.call({
        env,
        slug: this.envServiceSlug,
        version: this.envServiceVersion,
        dtoType: "env-service",
        op: "config",
        method: "GET",
        pathSuffix: `env-service/config?${query}`,
      });
    } catch (err) {
      throw new Error(
        "SVCENV_CONFIG_HTTP: failed to call env-service for config. " +
          `Ops: ensure env-service is reachable and svcconfig contains a valid entry for ` +
          `"${this.envServiceSlug}@v${this.envServiceVersion}" in env="${env}". ` +
          `Detail: ${(err as Error)?.message ?? String(err)}`
      );
    }

    if (!wire || !Array.isArray(wire.items)) {
      throw new Error(
        "SVCENV_CONFIG_INVALID_RESPONSE: expected { items: [...] } where each item is DbEnvServiceDto JSON. " +
          "Ops: verify env-service 'config' handler and DTO.toBody() output."
      );
    }

    const items: DbEnvServiceDto[] = [];

    for (const item of wire.items) {
      if (!item || typeof item !== "object") {
        throw new Error(
          "SVCENV_CONFIG_INVALID_ITEM: bag item is not a JSON object. " +
            "Ops: inspect env-service /env-service/config handler and its DTO.toBody() output."
        );
      }

      try {
        // ADR-0102/0103: DTO hydration is registry-only.
        const dto = this.registry.create<DbEnvServiceDto>(
          "db.env-service.dto",
          item,
          { validate: true, mode: "wire" }
        );
        items.push(dto);
      } catch (err) {
        throw new Error(
          "SVCENV_CONFIG_DTO_HYDRATION_FAILED: failed to hydrate DbEnvServiceDto from response JSON. " +
            `Detail: ${(err as Error)?.message ?? String(err)}`
        );
      }
    }

    if (items.length === 0) {
      throw new Error(
        "SVCENV_CONFIG_EMPTY_BAG: env-service returned an empty items array. " +
          `Ops: ensure at least one DbEnvServiceDto exists for env="${env}", slug="${targetServiceSlug}", version=${version}.`
      );
    }

    return new DtoBag<DbEnvServiceDto>(items);
  }
}
