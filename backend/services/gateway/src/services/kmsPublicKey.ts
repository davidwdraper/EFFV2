// backend/services/gateway/src/services/kmsPublicKey.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Why:
 * - Provide a single, well-typed helper to pull the active **public key** for the
 *   Gateway’s KMS-managed ES256 signing key. This is the canonical source for the
 *   JWKS endpoint and for any internal key-caching logic.
 *
 * How:
 * - Uses the official Google Cloud KMS client to:
 *     1. Locate the key ring/version defined in env.
 *     2. Fetch the public key PEM.
 *     3. Convert PEM → JWK with `x`, `y`, `crv`, `kid` and `alg` ES256 fields.
 * - Returns a JWK object that can be dropped straight into a JWKS response.
 *
 * Security:
 * - Never exports the private key. Only the public key is fetched.
 * - Reads KMS config from env so stage/prod can point to different key rings.
 */

import { KeyManagementServiceClient } from "@google-cloud/kms";
import { createPublicKey } from "node:crypto";
import { exportJWK } from "jose";
import { logger } from "@eff/shared/src/utils/logger";

// ── Required envs (safe to keep in .env.* because they are public resource names)
const PROJECT_ID = process.env.KMS_PROJECT_ID!;
const LOCATION_ID = process.env.KMS_LOCATION_ID!;
const KEY_RING = process.env.KMS_KEY_RING!;
const KEY_NAME = process.env.KMS_KEY_NAME!;
const KEY_VERSION = process.env.KMS_KEY_VERSION ?? "1"; // can be rotated without code changes

// Compose the full KMS resource name once.
const KMS_KEY_VERSION_PATH = [
  "projects",
  PROJECT_ID,
  "locations",
  LOCATION_ID,
  "keyRings",
  KEY_RING,
  "cryptoKeys",
  KEY_NAME,
  "cryptoKeyVersions",
  KEY_VERSION,
].join("/");

/**
 * Fetch the active ES256 public key from Google KMS and return it as a JWK.
 * This is called by the JWKS router and can be reused wherever the public key is needed.
 */
export async function fetchGatewayJwk(): Promise<Record<string, unknown>> {
  if (!PROJECT_ID || !LOCATION_ID || !KEY_RING || !KEY_NAME) {
    throw new Error("KMS environment variables are not fully configured");
  }

  const client = new KeyManagementServiceClient();

  // 1. Fetch the PEM-formatted public key from KMS.
  const [result] = await client.getPublicKey({ name: KMS_KEY_VERSION_PATH });
  if (!result.pem) {
    throw new Error(`KMS public key not found at ${KMS_KEY_VERSION_PATH}`);
  }

  // 2. Convert PEM → CryptoKey and then → JWK.
  const publicKey = createPublicKey(result.pem);
  const jwk = await exportJWK(publicKey);

  // 3. Add ES256-specific fields for JWKS consumers.
  const kid = result.name?.split("/").pop() || "unknown";
  return {
    ...jwk,
    kid,
    alg: "ES256",
    use: "sig",
    kty: "EC",
  };
}

// Optional: eager prefetch to log readiness at boot.
export async function logKmsKeyReadiness() {
  try {
    const jwk = await fetchGatewayJwk();
    logger.info({ kid: jwk.kid }, "[kmsPublicKey] KMS signing key ready");
  } catch (err) {
    logger.error({ err }, "[kmsPublicKey] failed to fetch KMS signing key");
  }
}
