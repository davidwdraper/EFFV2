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
    // Production: call `/api/svcenv/v1/env/current` with S2S auth.
    return "dev";
  }

  /** Fetch env@slug@version config as a DTO (strict DTO boundary). */
  public async getConfig(opts: GetConfigOptions): Promise<SvcEnvDto> {
    const { slug, version, env } = opts;
    // Production: perform network call and pass the response into SvcEnvDto.fromJson().
    // Template: feed static JSON into the DTO to respect DTO ownership of validation/shape.
    return SvcEnvDto.fromJson({
      key: `${env}@${slug}@${version}`,
      slug,
      env,
      version,
      vars: {
        NV_HTTP_HOST: "127.0.0.1",
        NV_HTTP_PORT: "4015",
        SVCENV_DB_NAME: "nv_svcenv",
        SVCENV_DB_COLLECTION: "svcenv",
        SVCENV_DB_URI: "mongodb://127.0.0.1:27017",
      },
      etag: 'W/"template-etag"',
      updatedAt: new Date().toISOString(),
      updatedByUserId: "template",
      notes:
        "Template svcenv payload for bootstrap; replace with real svcenv service.",
    });
  }
}
