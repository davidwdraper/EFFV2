// backend/services/shared/src/utils/s2s/mintS2S.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Canonical S2S JWT minter for internal service↔service calls and for gateway upstream identity injection.
 * - Env-only configuration (no hard-coded secrets), explicit validation, audit-ready errors.
 */

import jwt from "jsonwebtoken";

const reqEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || !String(v).trim())
    throw new Error(`[shared:s2s] Missing env ${name}`);
  return String(v).trim();
};

export interface MintS2SOptions {
  ttlSec?: number; // default 60s
  meta?: Record<string, string>; // string-only for audit hygiene
  issuer?: string;
  audience?: string;
}

export function mintS2S(opts: MintS2SOptions = {}): string {
  const secret = reqEnv("S2S_JWT_SECRET");
  const issuer = opts.issuer ?? reqEnv("S2S_JWT_ISSUER");
  const audience = opts.audience ?? reqEnv("S2S_JWT_AUDIENCE");
  const ttlSec = Math.max(10, Math.min(3600, opts.ttlSec ?? 60));

  const payload: Record<string, string> = { sub: "s2s", ...(opts.meta ?? {}) };

  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    issuer,
    audience,
    expiresIn: ttlSec,
  });
}
