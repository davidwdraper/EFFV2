// backend/services/jwks/src/provider/JwksProviderFactory.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/provider/JwksProviderFactory.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Central factory to construct a JWKS provider implementation based on environment configuration.
 * - Enforces environment invariance and fail-fast initialization.
 *
 * Invariants:
 * - No literals or defaults; every required env var must be explicitly provided.
 * - Factory returns a provider implementing IJwksProvider (getJwks(): Promise<JwkSet>).
 * - Currently supports only the “gcp-kms” provider.
 * - Logs provider creation for visibility; no silent fallbacks.
 */

import { getLogger } from "@nv/shared/logger/Logger";
import { IJwksProvider } from "./IJwksProvider";
import { GcpKmsJwksProvider } from "./GcpKmsJwksProvider";

export class JwksProviderFactory {
  static create(): IJwksProvider {
    const log = getLogger().bind({
      service: "jwks",
      component: "JwksProviderFactory",
    });

    const providerType = process.env.NV_JWKS_PROVIDER;
    if (!providerType) {
      log.error("missing NV_JWKS_PROVIDER");
      throw new Error("NV_JWKS_PROVIDER missing (expected e.g. 'gcp-kms')");
    }

    switch (providerType) {
      case "gcp-kms":
        log.info({ providerType }, "creating GcpKmsJwksProvider");
        return new GcpKmsJwksProvider();
      default:
        log.error({ providerType }, "unknown_jwks_provider");
        throw new Error(`Unknown NV_JWKS_PROVIDER: ${providerType}`);
    }
  }
}
