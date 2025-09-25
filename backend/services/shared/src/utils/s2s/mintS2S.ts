/**
 * NowVibin — Shared Utils
 * Module: S2S JWT minter (KMS-signed, JWKS-verifiable)
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0031-remove-hmac-open-switch.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Replace HS256/HMAC minting with **KMS-backed asymmetric signing** (RS256).
 * - Tokens verify via JWKS; no shared secrets; no "open" bypass paths.
 * - Keep claims minimal and auditable; clamp TTL; include KMS key version in `kid`.
 *
 * Notes:
 * - Requires GOOGLE_APPLICATION_CREDENTIALS and the following envs:
 *     KMS_PROJECT_ID, KMS_LOCATION_ID, KMS_KEY_RING_ID, KMS_KEY_ID
 *   (We auto-select the newest ENABLED key **version** and cache it briefly.)
 */

import crypto from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { reqEnv, numEnv } from "@eff/shared/src/utils/envHelpers";

/* --------------------------------- types ---------------------------------- */

export interface MintS2SOptions {
  /** TTL seconds; clamped to [10, 3600]. Default 60. */
  ttlSec?: number;
  /** Override issuer claim (default: S2S_JWT_ISSUER). */
  issuer?: string;
  /** Override audience claim (default: S2S_JWT_AUDIENCE). */
  audience?: string;
  /** Extra custom claims merged into payload. */
  extra?: Record<string, unknown>;
}

/* ------------------------------- constants -------------------------------- */

const S2S_ISS = () => reqEnv("S2S_JWT_ISSUER");
const S2S_AUD = () => reqEnv("S2S_JWT_AUDIENCE");

const KMS_PROJECT_ID = () => reqEnv("KMS_PROJECT_ID");
const KMS_LOCATION_ID = () => reqEnv("KMS_LOCATION_ID");
const KMS_KEY_RING_ID = () => reqEnv("KMS_KEY_RING_ID");
const KMS_KEY_ID = () => reqEnv("KMS_KEY_ID");

// cache newest ENABLED key version for a short window to avoid per-mint listing
const KEY_VERSION_CACHE_MS = numEnv("KMS_KEY_VERSION_CACHE_MS", 60_000);

/* ------------------------------ KMS helpers ------------------------------- */

/** Build cryptoKey parent path (without version). */
function cryptoKeyPath(): string {
  return [
    "projects",
    KMS_PROJECT_ID(),
    "locations",
    KMS_LOCATION_ID(),
    "keyRings",
    KMS_KEY_RING_ID(),
    "cryptoKeys",
    KMS_KEY_ID(),
  ].join("/");
}

const kmsClient = new KeyManagementServiceClient();

let cachedVersionName: string | null = null;
let cachedAt = 0;

/**
 * Get newest ENABLED key version path: projects/.../cryptoKeyVersions/<n>
 * Why: JWKS should publish ENABLED versions; minting should match those.
 */
async function getActiveKeyVersionName(): Promise<string> {
  const now = Date.now();
  if (cachedVersionName && now - cachedAt < KEY_VERSION_CACHE_MS)
    return cachedVersionName;

  const parent = cryptoKeyPath();
  const [versions] = await kmsClient.listCryptoKeyVersions({ parent });
  // pick newest ENABLED by create time / name desc
  const enabled = (versions || []).filter((v) => v.state === "ENABLED");
  if (!enabled.length)
    throw new Error("[shared:s2s] No ENABLED KMS key versions found");
  enabled.sort((a, b) => String(b.name).localeCompare(String(a.name))); // name carries version suffix
  cachedVersionName = String(enabled[0].name);
  cachedAt = now;
  return cachedVersionName!;
}

/* ------------------------------ jwt helpers ------------------------------- */

function b64u(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Sign a compact JWS (RS256) using Google Cloud KMS `asymmetricSign`.
 * Why: jose KeyLike doesn't natively wrap KMS; we assemble compact JWT manually.
 */
async function signCompactRS256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  keyVersionName: string
): Promise<string> {
  const encHeader = b64u(JSON.stringify(header));
  const encPayload = b64u(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;

  const digest = crypto.createHash("sha256").update(signingInput).digest();

  const [sigResp] = await kmsClient.asymmetricSign({
    name: keyVersionName,
    digest: { sha256: digest },
  });

  const sig = sigResp.signature;
  if (!sig) throw new Error("[shared:s2s] KMS returned empty signature");

  const encSig = b64u(sig as Buffer);
  return `${signingInput}.${encSig}`;
}

/* --------------------------------- API ------------------------------------ */

/**
 * mintS2S — produce a KMS-signed RS256 S2S JWT (compact)
 *
 * Claims:
 * - iss, aud, sub="s2s", iat, exp
 * - plus any `extra` claims provided
 *
 * Header:
 * - alg=RS256, typ=JWT, kid=<KMS key version>
 */
export async function mintS2S(opts: MintS2SOptions = {}): Promise<string> {
  const issuer = opts.issuer ?? S2S_ISS();
  const audience = opts.audience ?? S2S_AUD();

  // Clamp TTL to a sane window; short-lived service tokens reduce blast radius.
  const ttlSec = Math.max(10, Math.min(3600, opts.ttlSec ?? 60));
  const nowSec = Math.floor(Date.now() / 1000);

  const payload: Record<string, unknown> = {
    iss: issuer,
    aud: audience,
    sub: "s2s",
    iat: nowSec,
    exp: nowSec + ttlSec,
    ...(opts.extra || {}),
  };

  const keyVersionName = await getActiveKeyVersionName();

  // alg: RS256 (KMS key should be RSA_SIGN_PKCS1_2048_SHA256 or compatible)
  const header = { alg: "RS256", typ: "JWT", kid: keyVersionName };

  return signCompactRS256(header, payload, keyVersionName);
}
