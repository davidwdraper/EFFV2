// backend/services/jwks/src/provider/GcpKmsJwksProvider.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/provider/GcpKmsJwksProvider.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Implementation of IJwksProvider that retrieves asymmetric public keys
 *   from Google Cloud KMS and formats them into RFC 7517 JWKs.
 *
 * Invariants:
 * - Fail-fast on any missing environment variable.
 * - Deterministic kid computation (env-driven strategy).
 * - Strict environment invariance: no literals or silent fallbacks.
 * - Returns fully validated JwkSet.
 */

import { getLogger } from "@nv/shared/logger/Logger";
import type { JwkSet, Jwk } from "@nv/shared/contracts/security/jwks.contract";
import { assertJwkSet } from "@nv/shared/contracts/security/jwks.contract";
import { IJwksProvider } from "./IJwksProvider";
import * as crypto from "node:crypto";

export class GcpKmsJwksProvider implements IJwksProvider {
  private readonly log = getLogger().bind({
    service: "jwks",
    component: "GcpKmsJwksProvider",
  });

  private readonly projectId = process.env.NV_GCP_PROJECT;
  private readonly locationId = process.env.NV_GCP_LOCATION;
  private readonly keyRing = process.env.NV_GCP_KMS_KEYRING;
  private readonly keyNames = process.env.NV_GCP_KMS_KEYS?.split(",").map((k) =>
    k.trim()
  );
  private readonly kidStrategy = process.env.NV_JWKS_KID_STRATEGY;

  constructor() {
    const missing: string[] = [];
    if (!this.projectId) missing.push("NV_GCP_PROJECT");
    if (!this.locationId) missing.push("NV_GCP_LOCATION");
    if (!this.keyRing) missing.push("NV_GCP_KMS_KEYRING");
    if (!this.keyNames || this.keyNames.length === 0)
      missing.push("NV_GCP_KMS_KEYS");
    if (!this.kidStrategy) missing.push("NV_JWKS_KID_STRATEGY");

    if (missing.length > 0) {
      throw new Error(`Missing required env vars: ${missing.join(", ")}`);
    }
  }

  /**
   * Fetches all configured public keys from Google Cloud KMS and returns a valid JWK Set.
   * Note: This version uses mocked JWK generation placeholders (no actual GCP SDK calls).
   */
  async getJwks(): Promise<JwkSet> {
    const start = Date.now();
    this.log.info(
      { keys: this.keyNames, kidStrategy: this.kidStrategy },
      "jwks_provider_fetch_begin"
    );

    // 🚧 Placeholder implementation — replace with actual GCP SDK integration later.
    const keys: Jwk[] = this.keyNames!.map((name) => {
      const kid = this.computeKid(name);
      return {
        kty: "RSA",
        kid,
        use: "sig",
        alg: "RS256",
        n: this.fakeBase64("n", name),
        e: this.fakeBase64("e", name),
      };
    });

    const jwkSet = { keys };
    const validated = assertJwkSet(jwkSet);

    this.log.info(
      { elapsedMs: Date.now() - start, count: validated.keys.length },
      "jwks_provider_fetch_success"
    );
    return validated;
  }

  /** Deterministic key ID (kid) computation strategy */
  private computeKid(input: string): string {
    switch (this.kidStrategy) {
      case "sha256-modulus":
      case "gcp-resource-hash":
        return crypto
          .createHash("sha256")
          .update(input)
          .digest("hex")
          .slice(0, 16);
      default:
        throw new Error(`Unknown NV_JWKS_KID_STRATEGY: ${this.kidStrategy}`);
    }
  }

  /** Generates deterministic but fake base64url strings for mock output */
  private fakeBase64(prefix: string, seed: string): string {
    const raw = crypto
      .createHash("sha256")
      .update(`${prefix}:${seed}`)
      .digest("base64url");
    return raw.slice(0, 32);
  }
}
