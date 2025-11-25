// backend/services/shared/src/env/svcenvClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env) [carried via env-service]
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope)  // NOTE: v2: wire = DTO JSON; no nested `doc`
 *
 * Purpose:
 * - Thin, strongly-typed client for env-service.
 * - All transport concerns (URL resolution, headers, requestId, future JWT) are
 *   delegated to SvcClient.
 *
 * Wire contract (v1, updated):
 * - DTO is the sole source of truth for shape; no secondary "doc" envelope.
 * - EnvServiceDto.toJson() produces the JSON items; EnvServiceDto.fromJson()
 *   hydrates them.
 *
 * - GET /api/env-service/v1/env-service/config?env=<env>&slug=<slug>&version=<version>
 *     → { items: [ <EnvServiceDto.toJson()>, ... ], meta?: { ... } }
 */

import { DtoBag } from "../dto/DtoBag";
import { EnvServiceDto } from "../dto/env-service.dto";
import { SvcClient, type WireBagJson } from "../s2s/SvcClient";

export type SvcEnvClientConfig = {
  /** Underlying SvcClient used for all S2S calls. */
  svcClient: SvcClient;
  /**
   * Target env-service slugKey. Default is "env-service@1".
   * Format: "<slug>@<version>" (e.g., "env-service@1").
   * When env-service v2 arrives, this can be overridden.
   */
  envServiceSlugKey?: string;
};

export type GetCurrentEnvArgs = {
  slug: string;
  version: number;
};

export type GetConfigArgs = {
  env: string;
  slug: string; // target service slug (e.g., "gateway", "auth")
  version: number; // target service version
};

export class SvcEnvClient {
  private readonly svcClient: SvcClient;
  private readonly envServiceSlug: string;
  private readonly envServiceVersion: number;

  constructor(cfg: SvcEnvClientConfig) {
    this.svcClient = cfg.svcClient;

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

  /**
   * Resolve the current logical environment for a given service.
   *
   * v1 behavior:
   *   - Reads NV_ENV from process.env.
   *   - Fails fast if NV_ENV is missing/empty.
   *
   * No HTTP call is made here; env-service does not currently expose an
   * implemented /env/current route in the v1 router.
   */
  public async getCurrentEnv(_args: GetCurrentEnvArgs): Promise<string> {
    const raw = process.env.NV_ENV;
    const env = typeof raw === "string" ? raw.trim() : "";

    if (!env) {
      throw new Error(
        "SVCENV_CURRENT_ENV_MISSING: NV_ENV is not set or empty. " +
          "Ops: set NV_ENV to the desired logical environment (e.g., 'dev', 'stage', 'prod') " +
          "for this service before starting the process."
      );
    }

    return env;
  }

  /**
   * Fetch the EnvServiceDto configuration bag for (env, slug, version).
   *
   * Wire contract (v1 router, DTO-first):
   *   GET /api/env-service/v1/env-service/config?env=<env>&slug=<slug>&version=<version>
   *
   * Response shape:
   *   {
   *     items: [
   *       // Each element is EnvServiceDto.toJson()
   *       {
   *         id: string;
   *         env: string;
   *         slug: string;
   *         version: number;
   *         vars: Record<string, string>;
   *         createdAt: string;
   *         updatedAt: string;
   *         updatedByUserId: string;
   *         // ...any additional DTO fields...
   *       },
   *       ...
   *     ],
   *     meta?: { ... }
   *   }
   *
   * Returns:
   *   DtoBag<EnvServiceDto>
   */
  public async getConfig(args: GetConfigArgs): Promise<DtoBag<EnvServiceDto>> {
    const { env, slug: targetServiceSlug, version } = args;

    // Build query string for the env-service config endpoint.
    const query =
      `env=${encodeURIComponent(env)}` +
      `&slug=${encodeURIComponent(targetServiceSlug)}` +
      `&version=${encodeURIComponent(String(version))}`;

    let wire: WireBagJson;
    try {
      wire = await this.svcClient.call({
        env,
        slug: this.envServiceSlug, // target: env-service
        version: this.envServiceVersion, // env-service API version
        dtoType: "env-service",
        op: "config",
        method: "GET",
        // Override the default "<dtoType>/<op>" suffix so we can attach query params.
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
        "SVCENV_CONFIG_INVALID_RESPONSE: expected { items: [...] } where each item " +
          "is EnvServiceDto JSON. Ops: verify env-service 'config' handler and DTO.toJson() output."
      );
    }

    const items: EnvServiceDto[] = [];

    for (const item of wire.items) {
      if (!item || typeof item !== "object") {
        throw new Error(
          "SVCENV_CONFIG_INVALID_ITEM: bag item is not a JSON object. " +
            "Ops: inspect env-service /env-service/config handler and its DTO.toJson() output."
        );
      }

      try {
        // DTO owns the contract; no 'doc' wrapper.
        const dto = EnvServiceDto.fromJson(item as unknown, { validate: true });
        items.push(dto);
      } catch (err) {
        throw new Error(
          "SVCENV_CONFIG_DTO_HYDRATION_FAILED: failed to hydrate EnvServiceDto " +
            "from response JSON. Ops: inspect the offending env-service document; " +
            "it may violate the EnvServiceDto contract. " +
            `Detail: ${(err as Error)?.message ?? String(err)}`
        );
      }
    }

    if (items.length === 0) {
      throw new Error(
        "SVCENV_CONFIG_EMPTY_BAG: env-service returned an empty items array. " +
          `Ops: ensure at least one EnvServiceDto document exists for env="${env}", ` +
          `slug="${targetServiceSlug}", version=${version}.`
      );
    }

    return new DtoBag<EnvServiceDto>(items);
  }
}
