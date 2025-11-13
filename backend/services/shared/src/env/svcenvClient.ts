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
 * Current wire contract (v1, updated):
 * - DTO is the sole source of truth for shape; no secondary "doc" envelope.
 * - EnvServiceDto.toJson() produces the JSON items; EnvServiceDto.fromJson()
 *   hydrates them.
 *
 * - GET /api/env-service/v1/env-service/config?env=<env>&slug=<slug>&version=<version>
 *     → { items: [ <EnvServiceDto.toJson()>, ... ], meta?: { ... } }
 */

import { DtoBag } from "../dto/DtoBag";
import { EnvServiceDto } from "../dto/env-service.dto";
import { SvcClient } from "../s2s/SvcClient";

export type SvcEnvClientConfig = {
  /** Underlying SvcClient used for all S2S calls. */
  svcClient: SvcClient;
  /**
   * Target env-service slugKey. Default is "env-service@1".
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
  slug: string;
  version: number;
};

type EnvConfigWire = {
  items: unknown[];
  meta?: unknown;
};

export class SvcEnvClient {
  private readonly svcClient: SvcClient;
  private readonly envServiceSlugKey: string;

  constructor(cfg: SvcEnvClientConfig) {
    this.svcClient = cfg.svcClient;
    this.envServiceSlugKey = cfg.envServiceSlugKey?.trim() || "env-service@1";
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
    const { env, slug, version } = args;

    const res = await this.svcClient.call<EnvConfigWire>(
      this.envServiceSlugKey,
      {
        method: "GET",
        path: "/api/env-service/v1/env-service/config",
        query: { env, slug, version },
      }
    );

    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `SVCENV_CONFIG_HTTP_${res.status}: env-service failed to return config bag ` +
          `for env="${env}", slug="${slug}", version=${version}. ` +
          "Ops: confirm a matching config document exists and that env-service indexes are healthy."
      );
    }

    const data = res.data;
    if (!data || !Array.isArray(data.items)) {
      throw new Error(
        "SVCENV_CONFIG_INVALID_RESPONSE: expected { items: [...] } where each item " +
          "is EnvServiceDto JSON. Ops: verify /env-service/config returns a JSON object " +
          "with an 'items' array."
      );
    }

    const items: EnvServiceDto[] = [];

    for (const item of data.items) {
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
          `Ops: ensure at least one EnvServiceDto document exists for env="${env}", slug="${slug}", version=${version}.`
      );
    }

    return new DtoBag<EnvServiceDto>(items);
  }
}
