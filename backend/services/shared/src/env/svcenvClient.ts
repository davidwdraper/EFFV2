// backend/services/shared/src/env/svcenvClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env) [carried via env-service]
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope)
 *
 * Purpose:
 * - Thin, strongly-typed client for env-service.
 * - All transport concerns (URL resolution, headers, requestId, future JWT) are
 *   delegated to SvcClient.
 *
 * Wire contract (deterministic):
 * - GET /api/env-service/v1/env/current?slug=<slug>&version=<version>
 *     → { env: string }
 *
 * - GET /api/env-service/v1/config?env=<env>&slug=<slug>&version=<version>
 *     → { items: [ { type: "env-service", doc: { ...vars... } }, ... ] }
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

type EnvCurrentWire = {
  env: string;
};

type EnvConfigItemWire = {
  type: string;
  doc: unknown;
};

type EnvConfigWire = {
  items: EnvConfigItemWire[];
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
   * Deterministic contract:
   *   { env: string }
   */
  public async getCurrentEnv(args: GetCurrentEnvArgs): Promise<string> {
    const { slug, version } = args;

    const res = await this.svcClient.call<EnvCurrentWire>(
      this.envServiceSlugKey,
      {
        method: "GET",
        path: "/api/env-service/v1/env/current",
        query: { slug, version },
      }
    );

    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `SVCENV_CURRENT_ENV_HTTP_${res.status}: env-service failed to resolve current env ` +
          `for slug="${slug}", version=${version}. ` +
          "Ops: inspect env-service logs, health endpoint, and routing configuration."
      );
    }

    const data = res.data;
    if (!data || typeof data.env !== "string" || !data.env.trim()) {
      throw new Error(
        "SVCENV_CURRENT_ENV_INVALID_RESPONSE: expected { env: string }. " +
          "Ops: verify /env/current returns a JSON object with a non-empty 'env' field."
      );
    }

    return data.env.trim();
  }

  /**
   * Fetch the EnvServiceDto configuration bag for (env, slug, version).
   *
   * Deterministic wire contract:
   *   { items: [ { type: "env-service", doc: { ... } }, ... ] }
   *
   * Returns:
   *   DtoBag<EnvServiceDto> (bag purity; no naked DTOs cross the boundary).
   */
  public async getConfig(args: GetConfigArgs): Promise<DtoBag<EnvServiceDto>> {
    const { env, slug, version } = args;

    const res = await this.svcClient.call<EnvConfigWire>(
      this.envServiceSlugKey,
      {
        method: "GET",
        path: "/api/env-service/v1/config",
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
        "SVCENV_CONFIG_INVALID_RESPONSE: expected { items: [...] } bag envelope. " +
          "Ops: verify /config returns a JSON object with an 'items' array of { type, doc } entries."
      );
    }

    const items: EnvServiceDto[] = [];

    for (const item of data.items) {
      if (!item || typeof item !== "object") {
        throw new Error(
          "SVCENV_CONFIG_INVALID_ITEM: bag item is not an object. " +
            "Ops: inspect env-service /config handler and its DTO-to-wire mapper."
        );
      }

      const { type, doc } = item as EnvConfigItemWire;

      if (type !== "env-service") {
        throw new Error(
          `SVCENV_CONFIG_WRONG_TYPE: expected type "env-service", got "${type}". ` +
            "Ops: ensure /config only returns EnvServiceDto items for this endpoint."
        );
      }

      if (!doc || typeof doc !== "object") {
        throw new Error(
          "SVCENV_CONFIG_MISSING_DOC: bag item is missing a valid 'doc' object. " +
            "Ops: inspect the stored EnvServiceDto document for corruption or mapping errors."
        );
      }

      try {
        const dto = EnvServiceDto.fromJson(doc, { validate: true });
        items.push(dto);
      } catch (err) {
        throw new Error(
          "SVCENV_CONFIG_DTO_HYDRATION_FAILED: failed to hydrate EnvServiceDto from 'doc'. " +
            "Ops: inspect the offending env-service document; it may violate the EnvServiceDto contract. " +
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
