// backend/services/jwks/src/provider/KmsJwksProvider.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/provider/KmsJwksProvider.ts
 *
 * Docs / Invariants:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0035 — JWKS via GCP KMS with TTL Cache
 * - ADR-0017 — JWKS Service carve-out (policy/public route)
 *
 * Purpose (single concern):
 * - Fetch a public key from Google Cloud KMS and publish it as a strict RFC 7517 JWK Set.
 *
 * Why:
 * - Private keys must never leave KMS. We only expose the public key(s) as JWK.
 * - Deterministic kid enables clients to pin/verify.
 *
 * Notes:
 * - No caching here. Caching is owned by JwksCache (composition > hidden state).
 * - Environment invariance: no literals, no fallbacks. Everything comes from JwksEnv/asserted values.
 * - We rely on `jose` to convert SPKI (PEM) → JWK safely.
 */

import type { IJwksProvider } from "./IJwksProvider";
import type { Jwk, JwkSet } from "@nv/shared/contracts/security/jwks.contract";
import {
  assertJwk,
  assertJwkSet,
  EcCrvSchema,
} from "@nv/shared/contracts/security/jwks.contract";
import type { JwksEnvValues } from "../env/JwksEnv";

// GCP KMS SDK
import { KeyManagementServiceClient } from "@google-cloud/kms";
// SPKI(PEM) → JWK conversion
import { importSPKI, exportJWK } from "jose";

/** Map a KMS coordinate set to our deterministic `kid`. */
function makeKid(env: JwksEnvValues): string {
  // <project>:<location>:<ring>:<key>:<version>
  return [
    env.KMS_PROJECT_ID,
    env.KMS_LOCATION_ID,
    env.KMS_KEY_RING_ID,
    env.KMS_KEY_ID,
    env.KMS_KEY_VERSION,
  ].join(":");
}

/** Build the full KMS CryptoKeyVersion resource name. */
function kmsVersionResource(env: JwksEnvValues): string {
  // projects/{project}/locations/{location}/keyRings/{ring}/cryptoKeys/{key}/cryptoKeyVersions/{version}
  return [
    "projects",
    env.KMS_PROJECT_ID,
    "locations",
    env.KMS_LOCATION_ID,
    "keyRings",
    env.KMS_KEY_RING_ID,
    "cryptoKeys",
    env.KMS_KEY_ID,
    "cryptoKeyVersions",
    env.KMS_KEY_VERSION,
  ].join("/");
}

/** Convert a KMS SPKI (PEM) public key into a typed JWK with our invariants applied. */
async function spkiPemToPublicJwk(
  spkiPem: string,
  kid: string,
  alg: string
): Promise<Jwk> {
  // jose: importSPKI → CryptoKey, then exportJWK → {kty, n/e OR crv/x/y}
  const cryptoKey = await importSPKI(spkiPem, alg);
  const jwk = (await exportJWK(cryptoKey)) as Record<string, unknown>;

  // Enforce minimal fields and attach kid/use/alg
  const base: Record<string, unknown> = {
    ...jwk,
    kid,
    use: "sig",
    alg,
  };

  // Validate using shared strict union to prevent drift
  const typed = assertJwk(base);

  // Additional invariants for EC keys: ensure crv is explicitly supported
  if (typed.kty === "EC") {
    EcCrvSchema.parse(typed.crv);
  }

  return typed;
}

/**
 * KmsJwksProvider
 * - Fetches the public key (SPKI PEM) from KMS
 * - Converts to strict JWK
 * - Returns a one-key JWK Set (v1)
 */
export class KmsJwksProvider implements IJwksProvider {
  private readonly kms: KeyManagementServiceClient;
  private readonly env: JwksEnvValues;

  constructor(env: JwksEnvValues) {
    this.env = env;
    // KeyManagementServiceClient uses ADC if GOOGLE_APPLICATION_CREDENTIALS not provided.
    this.kms = new KeyManagementServiceClient();
  }

  async getJwks(): Promise<JwkSet> {
    const name = kmsVersionResource(this.env);
    const kid = makeKid(this.env);
    const alg = this.env.KMS_JWT_ALG; // Must be one of RS*, PS*, ES* (validated by Env)

    // 1) Fetch SPKI (PEM) public key from KMS
    const [res] = await this.kms.getPublicKey({ name });
    const pem = res.pem;
    if (!pem || typeof pem !== "string" || pem.trim().length === 0) {
      throw new Error("KMS returned empty public key PEM");
    }

    // 2) Convert SPKI PEM → JWK (rsa/ec)
    const jwk = await spkiPemToPublicJwk(pem, kid, alg);

    // 3) Wrap in JWK Set and validate
    const set: JwkSet = assertJwkSet({ keys: [jwk] });

    return set;
  }
}
