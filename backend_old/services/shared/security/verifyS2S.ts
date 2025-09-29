/**
 * NowVibin — Shared Security: verifyS2S (JWKS + asymmetric JWT verify)
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0031-remove-hmac-and-open-switch.md   // placeholder, update to actual id
 *
 * Why:
 * - Enforce S2S JWT verification using asymmetric keys (RS/ES) via JWKS.
 * - No legacy failovers: **no HS256, no shared secrets, no S2S_OPEN**.
 *
 * Behavior:
 * - Requires Bearer token. Verifies signature, `aud`, and `iss`.
 * - Uses remote JWKS with bounded network timeout and cooldown cache.
 * - Attaches parsed claims on `req.s2s` for downstream use.
 */

import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload } from "jose";

const JWKS_URL = mustEnv("S2S_JWKS_URL"); // e.g., http://127.0.0.1:4000/.well-known/jwks.json
const REQ_AUD = mustEnv("S2S_JWT_AUDIENCE"); // e.g., internal-services
const ALLOWED_ISSUERS = parseCsvEnv("S2S_ALLOWED_ISSUERS", [
  "gateway",
  "gateway-core",
]);
const CLOCK_TOLERANCE_SEC = numEnv("S2S_CLOCK_SKEW_SEC", 60);
const JWKS_TIMEOUT_MS = numEnv("S2S_JWKS_TIMEOUT_MS", 3000);
const JWKS_COOLDOWN_MS = numEnv("S2S_JWKS_COOLDOWN_MS", 60_000);

// Remote JWKS with caching and timeout controls
const JWKS = createRemoteJWKSet(new URL(JWKS_URL), {
  timeoutDuration: JWKS_TIMEOUT_MS,
  cooldownDuration: JWKS_COOLDOWN_MS,
});

/** Express middleware to protect S2S routes. */
export async function verifyS2S(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const auth = req.header("authorization") || req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json(problem("Unauthorized", "missing bearer token"));
    return;
  }
  const token = auth.slice(7).trim();
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      audience: REQ_AUD,
      issuer: ALLOWED_ISSUERS.length ? ALLOWED_ISSUERS : undefined,
      clockTolerance: `${CLOCK_TOLERANCE_SEC}s`,
    });

    // Minimal shape we forward
    (req as any).s2s = pickClaims(payload, [
      "iss",
      "aud",
      "sub",
      "svc",
      "iat",
      "exp",
      "jti",
    ]);
    return next();
  } catch (err: unknown) {
    return handleJwtError(res, err);
  }
}

/* --------------------------------- helpers -------------------------------- */

function mustEnv(key: string): string {
  const v = process.env[key];
  if (!v || !v.trim()) throw new Error(`Missing required env: ${key}`);
  return v.trim();
}

function numEnv(key: string, def: number): number {
  const v = process.env[key];
  const n = v ? Number(v) : def;
  return Number.isFinite(n) ? n : def;
}

function parseCsvEnv(key: string, def: string[] = []): string[] {
  const v = process.env[key];
  if (!v) return def;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickClaims(payload: JWTPayload, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in payload) out[k] = (payload as any)[k];
  return out;
}

function problem(title: string, detail: string) {
  const instance =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID()
      : String(Math.random()).slice(2);
  return {
    type: "about:blank",
    title,
    status: title === "Unauthorized" ? 401 : 403,
    detail,
    instance,
  };
}

function handleJwtError(res: Response, err: unknown) {
  // Map jose errors to clean client messages; never leak internals
  if (err instanceof errors.JWTExpired) {
    res.status(401).json(problem("Unauthorized", "token expired"));
    return;
  }
  if (err instanceof errors.JWTInvalid) {
    res.status(401).json(problem("Unauthorized", "invalid token"));
    return;
  }
  if (err instanceof errors.JWSSignatureVerificationFailed) {
    res
      .status(401)
      .json(problem("Unauthorized", "signature verification failed"));
    return;
  }
  if (err instanceof errors.JWTClaimValidationFailed) {
    // audience/issuer/nbf etc.
    res.status(403).json(problem("Forbidden", "claim validation failed"));
    return;
  }
  // Fallback for network/JWKS issues
  res.status(401).json(problem("Unauthorized", "unable to verify token"));
}
