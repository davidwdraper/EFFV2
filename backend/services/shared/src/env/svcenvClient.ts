// backend/services/shared/src/env/svcenvClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env)
 *
 * Purpose:
 * - svcenv client interface used at bootstrap.
 * - Returns a SvcEnvDto only; no JSON escapes this module.
 *
 * Notes:
 * - This implementation is dependency-free and suitable for templates.
 * - A production implementation may use SvcClient and S2S auth under the same interface.
 */

import { SvcEnvDto } from "../dto/svcenv.dto";

export interface GetCurrentEnvOptions {
  slug: string;
  version: number;
}

export interface GetConfigOptions {
  slug: string;
  version: number;
  env: string; // e.g., "dev" | "stage" | "prod"
}

export class SvcEnvClient {
  constructor(private readonly bootstrapUri: string) {
    if (!bootstrapUri || !bootstrapUri.trim()) {
      throw new Error("SvcEnvClient requires a non-empty bootstrap URI.");
    }
  }

  /** Resolve the current environment for the calling service. */
  public async getCurrentEnv(_opts: GetCurrentEnvOptions): Promise<string> {
    // Template implementation: return a stable value synchronously.
    return "dev";
  }

  /** Fetch env@slug@version config as a DTO (strict DTO boundary). */
  public async getConfig(opts: GetConfigOptions): Promise<SvcEnvDto> {
    const { slug, version, env } = opts;

    // For local dev, align with what our Mongo adapter expects:
    // Prefer NV_MONGO_* (and keep SVCENV_DB_* for future svcenv service).
    const NV_HTTP_HOST = "127.0.0.1";
    const NV_HTTP_PORT = slug === "xxx" ? "4015" : "4015";

    // Mongo — pick sane local defaults; adapter will read NV_MONGO_* first.
    const NV_MONGO_URI = "mongodb://127.0.0.1:27017";
    const NV_MONGO_DB = "nv_env_dev";
    const NV_MONGO_COLLECTION = slug; // use service slug for collection in template

    // New: default log level for local dev
    const LOG_LEVEL = "debug";

    //const NV_COLLECTION_XXX_VALUES = "env-service-values";
    const NV_COLLECTION_ENV_SERVICE_VALUES = "env-service-values";

    return SvcEnvDto.fromJson({
      key: `${env}@${slug}@${version}`,
      slug,
      env,
      version,
      vars: {
        // HTTP listener
        NV_HTTP_HOST,
        NV_HTTP_PORT,

        // Logging
        LOG_LEVEL,

        // Mongo (what adapters look for)
        NV_MONGO_URI,
        NV_MONGO_DB,
        NV_MONGO_COLLECTION,

        //NV_COLLECTION_XXX_VALUES,
        NV_COLLECTION_ENV_SERVICE_VALUES,

        // Legacy svcenv keys kept for forward/back compat (no harm)
        SVCENV_DB_URI: NV_MONGO_URI,
        SVCENV_DB_NAME: NV_MONGO_DB,
        SVCENV_DB_COLLECTION: NV_MONGO_COLLECTION,
      },
      etag: 'W/"template-etag"',
      updatedAt: new Date().toISOString(),
      updatedByUserId: "template",
      notes:
        "Template svcenv payload for bootstrap; replace with real svcenv service.",
    });
  }
}
