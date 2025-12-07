// backend/services/shared/src/security/getBearerToken.ts
/**
 * NowVibin (NV)
 * Docs:
 * - ADR-0036 — Token Minter using GCP KMS Sign
 * - ADR-0035 — JWKS Service for Public Keys
 * - SOP (Reduced, Clean)
 *
 * Purpose (single concern):
 * - Lazily initialize a process-wide MintProvider (TTL cache over Minter)
 *   and return compact JWTs for outbound S2S calls.
 *
 * Invariants:
 * - Fail-fast on missing env/config (except issuer: NV_SERVICE_NAME is an allowed deterministic source).
 * - No policy: every outbound call is signed this sprint.
 * - SvcClient should not deal with claims beyond aud.
 */

import type { Minter } from "./Minter";
import { Minter as _Minter } from "./Minter";
import { KmsJwtSigner } from "./KmsJwtSigner";
import { MinterEnv } from "./MinterEnv";
import { MintProvider } from "./MintProvider";
import { type IBoundLogger } from "../logger/Logger";

let _provider: MintProvider | undefined;

function requireInt(
  name: string,
  v: string | undefined,
  { allowZero = false }: { allowZero?: boolean } = {}
): number {
  if (v == null || v.trim() === "") {
    // Ops guidance: this is configuration, not code — fix env-service / svcenv for the calling service.
    throw new Error(
      `[getBearerToken] missing required env ${name}; ensure it is provided by env-service for this service/env`
    );
  }
  const n = Number(v);
  if (!Number.isFinite(n) || (!allowZero && n <= 0) || (allowZero && n < 0)) {
    // Ops guidance: value is present but invalid; fix the numeric value in env-service.
    throw new Error(
      `[getBearerToken] env ${name} must be a ${
        allowZero ? "non-negative" : "positive"
      } integer; update its value in env-service`
    );
  }
  return Math.floor(n);
}

function resolveIssuer(explicitIss?: string, logger?: IBoundLogger): string {
  const iss = explicitIss?.trim();
  if (iss) return iss;

  const envIss = (process.env.NV_ISSUER ?? "").trim();
  if (envIss) return envIss;

  const svcName = (process.env.NV_SERVICE_NAME ?? "").trim();
  if (svcName) {
    logger?.info(
      { iss: svcName },
      "getBearerToken: using NV_SERVICE_NAME as issuer; set NV_ISSUER to override per service/env"
    );
    return svcName;
  }

  // Ops guidance: this is a hard configuration miss; env-service / deployment must be fixed.
  throw new Error(
    "[getBearerToken] issuer is required: set NV_ISSUER or NV_SERVICE_NAME, or pass opts.iss; check env-service config for this service/env"
  );
}

function ensureProvider(logger?: IBoundLogger): MintProvider {
  if (_provider) return _provider;

  // 1) Build signer + minter (MinterEnv.assert() fails fast if misconfigured)
  const env = MinterEnv.assert();
  const signer = new KmsJwtSigner(env, { log: logger });
  const minter: Minter = new _Minter({ signer, log: logger });

  // 2) Required timing knobs for MintProvider (fail-fast, no defaults)
  const earlyRefreshSec = requireInt(
    "NV_TOKEN_EARLY_REFRESH_SEC",
    process.env.NV_TOKEN_EARLY_REFRESH_SEC
  );
  const clockSkewSec = requireInt(
    "S2S_CLOCK_SKEW_SEC",
    process.env.S2S_CLOCK_SKEW_SEC,
    { allowZero: true }
  );

  _provider = new MintProvider({
    minter,
    signer, // namespacing cache by kid/alg
    earlyRefreshSec,
    clockSkewSec,
    log: logger,
  });

  logger?.info(
    {
      earlyRefreshSec,
      clockSkewSec,
      kid: signer.kid(),
      alg: signer.alg(),
    },
    "getBearerToken: MintProvider initialized; verify S2S clock skew and refresh settings in env-service if tokens misbehave"
  );

  return _provider;
}

/**
 * Get (or reuse) a compact JWT for outbound S2S.
 * SvcClient passes aud (slug); we standardize ttl/iss/sub here.
 */
export async function getBearerToken(opts: {
  aud: string;
  ttlSec: number;
  iss?: string; // optional; if absent, derives from NV_ISSUER or NV_SERVICE_NAME
  sub?: string;
  logger?: IBoundLogger;
}): Promise<string> {
  if (!opts?.aud || typeof opts.aud !== "string") {
    // Ops guidance: caller bug — ensure SvcClient passes a non-empty slug as aud.
    throw new Error(
      "[getBearerToken] aud is required and must be a non-empty string; check SvcClient call sites for a valid service slug"
    );
  }
  if (!(opts.ttlSec > 0)) {
    // Ops guidance: caller bug or misconfig — ttlSec should be a sane positive value for S2S tokens.
    throw new Error(
      "[getBearerToken] ttlSec must be > 0; ensure callers pass a positive TTL in seconds (e.g., 60–900)"
    );
  }

  const provider = ensureProvider(opts.logger);
  const resolvedIss = resolveIssuer(opts.iss, opts.logger);

  const token = await provider.getToken({
    aud: opts.aud,
    ttlSec: opts.ttlSec,
    iss: resolvedIss,
    sub: opts.sub,
    // nbfSkewSec/extra can be added later if needed
  });

  return token.jwt;
}
