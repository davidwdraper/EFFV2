// backend/services/shared/src/utils/s2s/mintUserAssertion.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Centralize end-user assertion minting (HS256) so both gateway and tests use the same logic.
 * - Avoids ESM-only crypto deps in edge; uses jsonwebtoken for consistency across services.
 */

import jwt from "jsonwebtoken";

const reqEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || !String(v).trim())
    throw new Error(`[shared:userAssertion] Missing env ${name}`);
  return String(v).trim();
};

export interface UserAssertionClaims {
  sub: string; // user id (UUID/ULID), not PII like email
  ctx?: Record<string, string>; // optional extra context (all strings)
}

export interface MintUserAssertionOptions {
  ttlSec?: number; // default 300s
  issuer?: string;
  audience?: string;
}

export function mintUserAssertion(
  claims: UserAssertionClaims,
  opts: MintUserAssertionOptions = {}
): string {
  if (!claims?.sub) throw new Error("[shared:userAssertion] sub is required");
  const secret = reqEnv("USER_ASSERTION_SECRET");
  const issuer = opts.issuer ?? reqEnv("USER_ASSERTION_ISSUER");
  const audience = opts.audience ?? reqEnv("USER_ASSERTION_AUDIENCE");
  const ttlSec = Math.max(30, Math.min(3600, opts.ttlSec ?? 300));

  const payload: Record<string, string> = {
    sub: claims.sub,
    ...(claims.ctx ?? {}),
  };

  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    issuer,
    audience,
    expiresIn: ttlSec,
  });
}
