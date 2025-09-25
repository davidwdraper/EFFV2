/**
 * NowVibin — Gateway
 * Middleware: authGate (end-user auth via JWKS; no HS256/HMAC)
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0031-remove-hmac-open-switch.md
 *
 * Why:
 * - KMS/JWKS everywhere: verify user/client JWTs with asymmetric keys via JWKS.
 * - No shared secrets, no HS256, no “open” bypass. Fewer branches → fewer bugs.
 * - Keep route protection semantics: GET is public unless prefixed; non-GET requires auth
 *   except whitelisted auth endpoints; read-only mode blocks mutations with exemptions.
 */

import type { Request, RequestHandler } from "express";
import type { JWTPayload } from "jose"; // type-only; runtime import is dynamic (ESM library)

// jose@6 is ESM-only; our runtime is CJS. Use a cached dynamic import.
// Why: avoids ERR_REQUIRE_ESM while keeping static types above.
let _jose: Promise<typeof import("jose")> | null = null;
function jose() {
  return (_jose ??= import("jose"));
}

/* ───────────────────────── small env helper (local) ───────────────────────
   Why: avoid brittle /src imports; shared exports may change. Keep this tiny.
--------------------------------------------------------------------------- */
function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env: ${name}`);
  return v.trim();
}

/* ───────────────────────── Route policy helpers ──────────────────────────── */

function toList(v?: string) {
  return String(v || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function startsWithAny(path: string, prefixes: string[]) {
  const p = (path || "/").toLowerCase();
  return prefixes.some((x) => x && p.startsWith(x.toLowerCase()));
}

/** Extract token from common headers/cookies. Accepts:
 *  - Authorization: Bearer <jwt> OR raw <jwt>
 *  - x-access-token / x-auth-token / x-authorization
 *  - Cookies: auth / token / jwt
 */
function extractAuthzToken(req: Request): string | undefined {
  const hAuth =
    (req.headers["authorization"] as string | undefined) ??
    (req.headers["Authorization"] as unknown as string | undefined);
  if (hAuth && typeof hAuth === "string") {
    const trimmed = hAuth.trim();
    if (/^bearer\s+/i.test(trimmed))
      return trimmed.replace(/^bearer\s+/i, "").trim();
    return trimmed;
  }
  const alt = ["x-access-token", "x-auth-token", "x-authorization"] as const;
  for (const name of alt) {
    const v = req.headers[name];
    if (typeof v === "string" && v) return v.trim();
  }
  const c = (req as any).cookies as Record<string, string> | undefined;
  if (c) {
    if (c.auth) return c.auth.trim();
    if (c.token) return c.token.trim();
    if (c.jwt) return c.jwt.trim();
  }
  return undefined;
}

function tokensEqual(a?: string, b?: string) {
  const raw = (x?: string) => (x ? x.replace(/^bearer\s+/i, "").trim() : "");
  return raw(a) === raw(b);
}

/* ─────────────────────────── JWKS verifiers ────────────────────────────────
   Why: Centralize asymmetric verification; bounded timeout + cooldown cache
   so we don't hammer the JWKS endpoint on each request.
--------------------------------------------------------------------------- */

type VerifyOpts = {
  jwksUrl: string;
  issuer?: string | string[];
  audience?: string | string[];
  timeoutMs: number;
  cooldownMs: number;
  clockSkewSec: number;
};

function buildRemoteJwks(url: string, timeoutMs: number, cooldownMs: number) {
  return jose().then(({ createRemoteJWKSet }) =>
    createRemoteJWKSet(new URL(url), {
      timeoutDuration: timeoutMs,
      cooldownDuration: cooldownMs,
    })
  );
}

async function verifyWithJwks(
  token: string,
  opts: VerifyOpts
): Promise<JWTUserClaims> {
  const [{ jwtVerify }, JWKS] = await Promise.all([
    jose(),
    buildRemoteJwks(opts.jwksUrl, opts.timeoutMs, opts.cooldownMs),
  ]);
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: opts.issuer,
    audience: opts.audience,
    clockTolerance: `${opts.clockSkewSec}s`,
  });
  return normalizeUserClaims(payload);
}

/* ─────────────────────────── Claims normalization ───────────────────────── */

type JWTUserClaims = {
  id: string;
  roles?: string[];
  scopes?: string[] | string;
  email?: string;
  name?: string;
  [k: string]: unknown;
};

function normalizeUserClaims(payload: JWTPayload): JWTUserClaims {
  const id =
    (payload.sub as string) ||
    (payload as any).uid ||
    (payload as any).userId ||
    "unknown";
  return {
    id,
    roles: (payload as any).roles || [],
    scopes: (payload as any).scopes || (payload as any).scope || [],
    email: (payload as any).email,
    name: (payload as any).name,
    ...payload,
  };
}

/* ────────────────────────────── Middleware ──────────────────────────────── */

export function authGate(): RequestHandler {
  // Policy toggles
  const readOnlyMode = String(process.env.READ_ONLY_MODE || "false") === "true";
  const protectedGetPrefixes = toList(
    process.env.PUBLIC_GET_REQUIRE_AUTH_PREFIXES
  );
  const authPublicPrefixes = toList(
    process.env.AUTH_PUBLIC_PREFIXES ||
      "/auth/login|/auth/create|/auth/password_reset|/auth/verify"
  );
  const readOnlyExemptPrefixes = toList(
    process.env.READ_ONLY_EXEMPT_PREFIXES || "/auth/login|/auth/verify"
  );

  // E2E shortcuts (kept for test harness ONLY)
  const e2eMode = process.env.E2E_REQUIRE_AUTH === "1";
  const e2eBearer = process.env.E2E_BEARER;

  // End-user assertion (preferred path) — all via JWKS
  const UA_JWKS_URL = reqEnv("USER_ASSERTION_JWKS_URL"); // e.g., https://.../.well-known/jwks.json
  const UA_ISS = reqEnv("USER_ASSERTION_ISSUER"); // e.g., IdP issuer
  const UA_AUD = reqEnv("USER_ASSERTION_AUDIENCE"); // e.g., "internal-users"
  const UA_TIMEOUT = Number(process.env.USER_ASSERTION_JWKS_TIMEOUT_MS || 3000);
  const UA_COOLDOWN = Number(
    process.env.USER_ASSERTION_JWKS_COOLDOWN_MS || 60_000
  );
  const UA_SKEW = Number(process.env.USER_ASSERTION_CLOCK_SKEW_SEC || 30);

  // Optional client token verification via JWKS (best-effort; not required)
  const CLIENT_JWKS_URL = process.env.CLIENT_JWKS_URL || ""; // if unset, skip client verify
  const CLIENT_ISS = process.env.CLIENT_JWT_ISSUER || undefined;
  const CLIENT_AUD = process.env.CLIENT_JWT_AUDIENCE || undefined;
  const CLIENT_TIMEOUT = Number(process.env.CLIENT_JWKS_TIMEOUT_MS || 3000);
  const CLIENT_COOLDOWN = Number(process.env.CLIENT_JWKS_COOLDOWN_MS || 60_000);
  const CLIENT_SKEW = Number(process.env.CLIENT_JWT_CLOCK_SKEW_SEC || 60);

  return async (req, res, next) => {
    const method = (req.method || "GET").toUpperCase();
    const path = req.path || "/";

    // Read-only: block mutations except explicit exemptions
    if (
      readOnlyMode &&
      method !== "GET" &&
      method !== "HEAD" &&
      !startsWithAny(path, readOnlyExemptPrefixes)
    ) {
      return res.status(503).json({
        type: "about:blank",
        title: "Service Unavailable",
        status: 503,
        detail:
          "Read-only mode is enabled; mutations are temporarily disabled.",
        instance: (req as any).id,
      });
    }

    // Determine if this request needs auth
    const isProtectedGet =
      method === "GET" && startsWithAny(path, protectedGetPrefixes);
    const isAuthPublic = startsWithAny(path, authPublicPrefixes);
    const needsAuth =
      method !== "GET" && method !== "HEAD" ? !isAuthPublic : isProtectedGet;

    if (!needsAuth) return next();

    // Prefer the end-user assertion header (matches smoke/lib/s2s.sh)
    const userAssertion =
      (req.headers["x-nv-user-assertion"] as string | undefined) ??
      (req.headers["X-NV-User-Assertion"] as unknown as string | undefined);

    // Optional: client 'Authorization' (best-effort)
    const clientAuth = extractAuthzToken(req);

    // ── E2E fast-paths (for smoke only; does not use secrets) ───────────────
    if (e2eMode) {
      if (e2eBearer && clientAuth && tokensEqual(clientAuth, e2eBearer)) {
        (req as any).user = {
          id: "e2e-user",
          roles: ["tester"],
          scopes: ["*"],
        };
        return next();
      }
      // No more user-assertion local HS256; stick to JWKS paths only.
    }

    // ── Normal path: require a valid user assertion for protected routes ────
    if (!userAssertion) {
      return res.status(401).json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Missing user assertion (X-NV-User-Assertion).",
        instance: (req as any).id,
      });
    }

    try {
      // Verify end-user assertion via JWKS (ADR-0030/0031)
      const user = await verifyWithJwks(userAssertion, {
        jwksUrl: UA_JWKS_URL,
        issuer: UA_ISS,
        audience: UA_AUD,
        timeoutMs: UA_TIMEOUT,
        cooldownMs: UA_COOLDOWN,
        clockSkewSec: UA_SKEW,
      });
      (req as any).user = user;

      // Optionally validate client Authorization via JWKS (best-effort; do not block)
      if (clientAuth && CLIENT_JWKS_URL) {
        verifyWithJwks(clientAuth, {
          jwksUrl: CLIENT_JWKS_URL,
          issuer: CLIENT_ISS,
          audience: CLIENT_AUD,
          timeoutMs: CLIENT_TIMEOUT,
          cooldownMs: CLIENT_COOLDOWN,
          clockSkewSec: CLIENT_SKEW,
        })
          .then((claims) => {
            (req as any).client = claims;
          })
          .catch(() => {
            /* best-effort only — do not block */
          });
      }

      return next();
    } catch (err) {
      const status = mapJoseErrorToStatus(err);
      return res.status(status).json({
        type: "about:blank",
        title: status === 401 ? "Unauthorized" : "Forbidden",
        status,
        detail:
          status === 401
            ? "Invalid or expired user assertion."
            : "JWT claim validation failed.",
        instance: (req as any).id,
      });
    }
  };
}

/* ─────────────────────────── Error mapping ──────────────────────────────── */

function mapJoseErrorToStatus(err: unknown): number {
  // Avoid importing jose.errors eagerly; check by name (works across ESM boundary)
  const name = (err as any)?.name;
  if (name === "JWTExpired") return 401;
  if (name === "JWSSignatureVerificationFailed") return 401;
  if (name === "JWTInvalid") return 401;
  if (name === "JWTClaimValidationFailed") return 403; // aud/iss/nbf, etc.
  return 401; // default: unable to verify
}
