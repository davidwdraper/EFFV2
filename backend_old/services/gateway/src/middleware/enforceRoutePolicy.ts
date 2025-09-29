// backend/services/gateway/src/middleware/enforceRoutePolicy.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route policy via svcconfig (mirror only)
 * - ADR-0032 NOTE: Health-route gateway bypass (exception for maintainability)
 *
 * Purpose:
 * - Enforce per-route policy fetched from the **local svcconfig mirror**.
 * - Default = require **user JWT** unless a rule explicitly allows anonymous
 *   or forbids assertions.
 * - Avoid ESM/CJS collisions by **lazy-loading** `jose` with a native dynamic
 *   import that TypeScript will not down-level to `require()`.
 *
 * Expectations:
 * - api.ts populates (req as any).parsedApiRoute = { slug, version, restPath }
 *   where version is like "v1" or "V1".
 */

import type { Request, Response, NextFunction } from "express";
import type { SvcConfig } from "@eff/shared/src/contracts/svcconfig.contract"; // type-only

// ── User JWT verification (edge) ──────────────────────────────────────────────
const USER_JWKS_URL = process.env.USER_JWKS_URL || "";
const USER_JWT_ISSUER = process.env.USER_JWT_ISSUER || "";
const USER_JWT_AUDIENCE = process.env.USER_JWT_AUDIENCE || "";
const CLOCK_SKEW = Number(process.env.USER_JWT_CLOCK_SKEW_SEC || "60");

/**
 * jose is ESM-only; our gateway currently builds to CJS.
 * IMPORTANT: plain `import('jose')` can get down-leveled by TS in CJS mode into
 * a Promise-wrapped **require()**, which explodes at runtime.
 * Use `(0, eval)('import("jose")')` to force a **native dynamic import**.
 */
type JoseMod = typeof import("jose");
let __jose__: Promise<JoseMod> | null = null;
function getJose(): Promise<JoseMod> {
  // eslint-disable-next-line no-eval
  return (__jose__ ??= (0, eval)("import('jose')") as Promise<JoseMod>);
}

// Remote JWKS cache (created via jose once)
let userJwks: ReturnType<Awaited<JoseMod>["createRemoteJWKSet"]> | null = null;

async function getUserJWKS() {
  if (userJwks) return userJwks;
  if (!USER_JWKS_URL) {
    const e: any = new Error("USER_JWKS_URL not configured");
    e.status = 500;
    throw e;
  }
  const { createRemoteJWKSet } = await getJose();
  userJwks = createRemoteJWKSet(new URL(USER_JWKS_URL));
  return userJwks;
}

async function verifyUserJwt(authorizationHeader: string) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    const e: any = new Error("Missing bearer token");
    e.status = 401;
    throw e;
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  const { jwtVerify } = await getJose();
  const jwks = await getUserJWKS();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: USER_JWT_ISSUER || undefined,
    audience: USER_JWT_AUDIENCE || undefined,
    clockTolerance: CLOCK_SKEW,
  });
  return payload;
}

// --- simple matcher: first-match, exact > :param > * ---
function tokenize(p: string) {
  return p.split("/").filter(Boolean);
}

function matchRule(
  method: string,
  normPath: string,
  rules: Array<{
    method: string;
    path: string;
    userAssertion: "required" | "optional" | "forbidden";
    public: boolean;
    opId?: string;
  }>
) {
  const m = method.toUpperCase();
  const candidates = rules.filter((r) => r.method.toUpperCase() === m);
  if (!candidates.length) return null;

  const inToks = tokenize(normPath);
  let best: { score: number; rule: any } | null = null;

  for (const r of candidates) {
    const wild = r.path.endsWith("*");
    const rulePath = wild ? r.path.slice(0, -1) : r.path;
    const rtoks = tokenize(rulePath);

    if (wild) {
      const ok = rtoks.every(
        (t, i) =>
          inToks[i] !== undefined && (t.startsWith(":") || t === inToks[i])
      );
      if (!ok) continue;
      const score = 1;
      if (!best || score > best.score) best = { score, rule: r };
      continue;
    }

    if (rtoks.length !== inToks.length) continue;
    let exact = 0,
      ok = true;
    for (let i = 0; i < rtoks.length; i++) {
      const rt = rtoks[i],
        it = inToks[i];
      if (rt.startsWith(":")) continue;
      if (rt !== it) {
        ok = false;
        break;
      }
      exact++;
    }
    if (!ok) continue;
    const score = 10 + exact;
    if (!best || score > best.score) best = { score, rule: r };
  }
  return best?.rule || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mirror-backed cfg getter (no network). Accepts a few shapes defensively.
// ──────────────────────────────────────────────────────────────────────────────
function getCfgFromMirror(slug: string, major: number): SvcConfig {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@eff/shared/src/svcconfig/client") as {
    getSvcconfigSnapshot: () =>
      | { services: Record<string, any> | undefined }
      | null
      | undefined;
  };

  const snap = mod.getSvcconfigSnapshot?.();
  if (!snap || !snap.services) {
    const e: any = new Error("svcconfig snapshot unavailable at gateway");
    e.status = 503;
    throw e;
  }

  const bySlug = snap.services[slug];
  let cfg: any = undefined;

  // Common flat shape: one cfg per slug
  if (bySlug?.baseUrl) {
    if (Number(bySlug.version ?? 1) === major) cfg = bySlug;
  }

  // Versioned map under slug?
  if (!cfg && bySlug && typeof bySlug === "object") {
    const key = `V${major}`;
    if (bySlug[key]) cfg = bySlug[key];
  }

  // Flattened key "slug.V1"
  if (!cfg) {
    const flatKey = `${slug}.V${major}`.toLowerCase();
    if ((snap.services as any)[flatKey]) cfg = (snap.services as any)[flatKey];
  }

  if (!cfg) {
    const e: any = new Error(`Unknown service slug "${slug}" for V${major}`);
    e.status = 404;
    throw e;
  }

  if (cfg.enabled !== true) {
    const e: any = new Error(`Service "${slug}" (V${major}) is disabled`);
    e.status = 503;
    throw e;
  }

  return cfg as SvcConfig;
}

// ── Public route bypass (avoid touching jose for these) ───────────────────────
const PUBLIC_MATCHERS: RegExp[] = [
  /^\/v\d+\/health$/, // health bypass (per ADR note)
  /^\/v\d+\/auth\/create$/, // auth create (public)
  /^\/v\d+\/auth\/login$/, // auth login (public)
  /^\/\.well-known\/jwks\.json$/, // JWKS
];

function isPublic(normPath: string): boolean {
  return PUBLIC_MATCHERS.some((rx) => rx.test(normPath));
}

// ──────────────────────────────────────────────────────────────────────────────

export async function enforceRoutePolicy(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = (req as any).parsedApiRoute as
      | { slug?: string; version?: string; restPath?: string }
      | undefined;
    if (!parsed?.slug || !parsed?.version) return next(); // not the versioned api shape

    const vMatch = /^v(\d+)$/i.exec(parsed.version);
    if (!vMatch) return next(); // unrecognized version tag

    const major = Number(vMatch[1]);
    const slug = String(parsed.slug).toLowerCase();
    const rest = String(parsed.restPath || "");
    // Normalize to "/v<major>/<rest>" for policy matching
    const normPath = ("/v" + major + "/" + rest)
      .replace(/\/{2,}/g, "/")
      .replace(/\/+$/, "");
    const method = req.method.toUpperCase();

    // ────────────────────── Health & public bypass ─────────────────────────────
    if (isPublic(normPath)) return next();
    // ──────────────────────────────────────────────────────────────────────────

    // Fetch config + policy for {slug, major} from the **local mirror only**.
    const cfg: SvcConfig = getCfgFromMirror(slug, major);
    const rule = matchRule(method, normPath, (cfg as any)?.policy?.rules ?? []);

    const auth = String(req.headers.authorization || "");

    if (!rule) {
      // Default fail-closed: require valid user token
      if (!auth)
        return res.status(401).json({
          title: "Unauthorized",
          status: 401,
          detail: "User token required",
        });
      await verifyUserJwt(auth);
      return next();
    }

    switch (rule.userAssertion) {
      case "required": {
        if (!auth)
          return res.status(401).json({
            title: "Unauthorized",
            status: 401,
            detail: "User token required",
          });
        await verifyUserJwt(auth);
        return next();
      }
      case "optional": {
        if (!auth) return next();
        await verifyUserJwt(auth); // invalid → 401
        return next();
      }
      case "forbidden": {
        if (auth)
          return res.status(403).json({
            title: "Forbidden",
            status: 403,
            detail: "User token not allowed",
          });
        return next();
      }
      default: {
        if (!auth)
          return res.status(401).json({
            title: "Unauthorized",
            status: 401,
            detail: "User token required",
          });
        await verifyUserJwt(auth);
        return next();
      }
    }
  } catch (err: any) {
    const status = err?.status ?? 500;
    const title =
      status === 401
        ? "Unauthorized"
        : status === 403
        ? "Forbidden"
        : "Internal Server Error";
    return res.status(status).json({
      title,
      status,
      detail: err?.message || "Policy enforcement error",
    });
  }
}
