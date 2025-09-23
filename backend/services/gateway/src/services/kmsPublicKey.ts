// backend/services/gateway/src/services/kmsPublicKey.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Why:
 * - Provide a single, well-typed helper to pull the active **public key** for the
 *   Gateway’s KMS-managed signing key. This is the canonical source for the
 *   JWKS endpoint and any internal key-caching logic.
 *
 * How:
 * - Reads env in a robust way:
 *     A) KMS_CRYPTO_KEY = projects/<proj>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>
 *        (optionally KMS_KEY_VERSION=<n>)
 *     B) Or individual parts:
 *        KMS_PROJECT_ID, KMS_LOCATION_ID, KMS_KEY_RING_ID, KMS_KEY_ID
 *        (optionally KMS_KEY_VERSION=<n>)
 * - If no KMS_KEY_VERSION is provided, selects the CryptoKey.PRIMARY version if present,
 *   else newest ENABLED CryptoKeyVersion.
 * - Fetches PEM public key for the chosen version and converts to JWK.
 * - Detects RSA vs EC(P-256) and sets alg accordingly (RS256 or ES256).
 *
 * Security:
 * - Only public key is fetched; no private key leaves KMS.
 */

import { KeyManagementServiceClient, protos } from "@google-cloud/kms";
import { createPublicKey } from "node:crypto";
import type { JWK } from "jose";
import { logger } from "@eff/shared/src/utils/logger";

// ESM-in-CJS bridge for `jose` (compatible with ts-node-dev)
let _jose: Promise<typeof import("jose")> | null = null;
const getJose = () => (_jose ??= import("jose"));

type Alg = "RS256" | "ES256";

type KmsEnv = {
  projectId: string;
  locationId: string;
  keyRingId: string;
  keyId: string;
  cryptoKeyPath: string; // projects/.../cryptoKeys/<key>
  keyVersion?: string; // number as string, e.g., "1"
};

function parseKmsEnv(): KmsEnv {
  const {
    KMS_CRYPTO_KEY = "",
    KMS_PROJECT_ID = "",
    KMS_LOCATION_ID = "",
    KMS_KEY_RING_ID = "",
    KMS_KEY_ID = "",
    KMS_KEY_VERSION = "",
  } = process.env;

  // Prefer full crypto key path if provided
  if (KMS_CRYPTO_KEY.trim()) {
    const m = KMS_CRYPTO_KEY.match(
      /^projects\/([^/]+)\/locations\/([^/]+)\/keyRings\/([^/]+)\/cryptoKeys\/([^/]+)$/
    );
    if (!m) {
      throw new Error(`KMS_CRYPTO_KEY is malformed: ${KMS_CRYPTO_KEY}`);
    }
    const [, projectId, locationId, keyRingId, keyId] = m;
    return {
      projectId,
      locationId,
      keyRingId,
      keyId,
      cryptoKeyPath: KMS_CRYPTO_KEY,
      keyVersion: KMS_KEY_VERSION?.trim() || undefined,
    };
  }

  // Otherwise require all four parts
  const missing: string[] = [];
  if (!KMS_PROJECT_ID) missing.push("KMS_PROJECT_ID");
  if (!KMS_LOCATION_ID) missing.push("KMS_LOCATION_ID");
  if (!KMS_KEY_RING_ID) missing.push("KMS_KEY_RING_ID");
  if (!KMS_KEY_ID) missing.push("KMS_KEY_ID");
  if (missing.length) {
    throw new Error(
      `KMS environment variables are not fully configured; missing: ${missing.join(
        ", "
      )}`
    );
  }

  const cryptoKeyPath = [
    "projects",
    KMS_PROJECT_ID,
    "locations",
    KMS_LOCATION_ID,
    "keyRings",
    KMS_KEY_RING_ID,
    "cryptoKeys",
    KMS_KEY_ID,
  ].join("/");

  return {
    projectId: KMS_PROJECT_ID,
    locationId: KMS_LOCATION_ID,
    keyRingId: KMS_KEY_RING_ID,
    keyId: KMS_KEY_ID,
    cryptoKeyPath,
    keyVersion: KMS_KEY_VERSION?.trim() || undefined,
  };
}

function versionPath(cryptoKeyPath: string, version: string) {
  return `${cryptoKeyPath}/cryptoKeyVersions/${version}`;
}

/**
 * Choose the key version:
 * - If explicit KMS_KEY_VERSION: use it.
 * - Else CryptoKey.primary if present,
 * - Else newest ENABLED version,
 * - Else throw.
 */
async function resolveVersion(
  client: KeyManagementServiceClient,
  cryptoKeyPath: string,
  explicitVersion?: string
): Promise<{ versionPath: string; kid: string }> {
  if (explicitVersion && explicitVersion.trim()) {
    const vp = versionPath(cryptoKeyPath, explicitVersion.trim());
    return { versionPath: vp, kid: explicitVersion.trim() };
  }

  // Get the CryptoKey to inspect .primary
  const [cryptoKey] = await client.getCryptoKey({ name: cryptoKeyPath });
  const primaryName = cryptoKey?.primary?.name ?? undefined;
  if (primaryName) {
    const kid = primaryName.split("/").pop() || "unknown";
    return { versionPath: primaryName, kid };
  }

  // Fall back to newest ENABLED version
  const [versions] = await client.listCryptoKeyVersions({
    parent: cryptoKeyPath,
    filter: "", // all
  });

  if (!versions || versions.length === 0) {
    throw new Error(`No crypto key versions found under ${cryptoKeyPath}`);
  }

  const enableStates =
    protos.google.cloud.kms.v1.CryptoKeyVersion.CryptoKeyVersionState;
  const enabled = versions
    .filter((v) => v.state === enableStates.ENABLED && !!v.name)
    .sort((a, b) => {
      const na = Number((a.name || "").split("/").pop());
      const nb = Number((b.name || "").split("/").pop());
      return nb - na; // newest first
    });

  if (enabled.length > 0 && enabled[0].name) {
    const name = enabled[0].name;
    const kid = name.split("/").pop() || "unknown";
    return { versionPath: name, kid };
  }

  throw new Error(
    `No PRIMARY or ENABLED versions found under ${cryptoKeyPath}`
  );
}

/**
 * Detect alg from PEM public key: RS256 for RSA, ES256 for P-256 EC.
 */
function detectAlgFromPem(pem: string): Alg {
  const key = createPublicKey(pem);
  const t = (key as any).asymmetricKeyType as string | undefined;
  if (t === "rsa") return "RS256";
  if (t === "ec") return "ES256";
  return "RS256";
}

/**
 * Fetch the active public key from Google KMS and return it as a JWK.
 */
export async function fetchGatewayJwk(): Promise<
  JWK & { kid: string; alg: Alg; use: "sig" }
> {
  const env = parseKmsEnv();
  const client = new KeyManagementServiceClient();

  // Resolve which version to use
  const { versionPath: vp, kid } = await resolveVersion(
    client,
    env.cryptoKeyPath,
    env.keyVersion
  );

  // Fetch PEM public key for that version
  const [pub] = await client.getPublicKey({ name: vp });
  if (!pub.pem) {
    throw new Error(`KMS public key not found at ${vp}`);
  }

  // Convert PEM → JWK
  const { exportJWK } = await getJose();
  const publicKey = createPublicKey(pub.pem);
  const jwk = (await exportJWK(publicKey)) as JWK;

  // Determine alg from key type
  const alg = detectAlgFromPem(pub.pem);

  return {
    ...(jwk as object),
    kid, // version number string, stable per version
    alg, // RS256 or ES256
    use: "sig", // signing
  } as JWK & { kid: string; alg: Alg; use: "sig" };
}

/**
 * Optional: eager prefetch to log readiness at boot.
 * Safe to call during startup; failures are logged and do not throw.
 */
export async function logKmsKeyReadiness() {
  try {
    const jwk = await fetchGatewayJwk();
    logger.info(
      { kid: jwk.kid, alg: jwk.alg },
      "[kmsPublicKey] KMS signing key ready"
    );
  } catch (err) {
    logger.error({ err }, "[kmsPublicKey] failed to fetch KMS signing key");
  }
}
