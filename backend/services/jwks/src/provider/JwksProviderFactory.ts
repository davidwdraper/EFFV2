// backend/services/jwks/src/provider/JwksProviderFactory.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/provider/JwksProviderFactory.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0035 — JWKS via GCP KMS with TTL Cache
 *
 * Purpose:
 * - Central factory for building an IJwksProvider implementation.
 * - Keeps provider choice out of routers/controllers and behind a tiny seam.
 *
 * Invariants:
 * - Environment invariance: this factory does NOT read process.env directly.
 *   The caller injects a validated env object (from JwksEnv.assert()).
 * - Single concern: choose + construct provider. No caching. No logic.
 */

import type { IJwksProvider } from "./IJwksProvider";
import type { JwksEnvValues } from "../env/JwksEnv";
import { KmsJwksProvider } from "./KmsJwksProvider";

export class JwksProviderFactory {
  /**
   * Build the concrete provider. For ADR-0035 v1, we only support GCP KMS.
   * To add providers later (aws-kms, azure-kv, file, etc.), extend JwksEnv and
   * switch on env.NV_JWKS_PROVIDER here.
   */
  static create(env: JwksEnvValues): IJwksProvider {
    return new KmsJwksProvider(env);
  }
}
