// backend/services/gateway/src/middleware/enforceRoutePolicy.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route policy via svcconfig
 * - ADR-0032 NOTE: Health-route gateway bypass (exception for maintainability)
 *
 * Enforces per-route policy fetched from svcconfig. Default = require user JWT
 * unless a rule explicitly allows anonymous or forbids assertions.
 *
 * This middleware expects api.ts to have populated:
 *   (req as any).parsedApiRoute = { slug, version, restPath }
 * where version is like "v1" or "V1".
 */

import type { Request, Response, NextFunction } from "express";
import type { SvcConfig } from "@eff/shared/src/contracts/svcconfig.contract"; // type-only
import { fetchSvcConfig } from "../clients/svcconfigClient";

// --- user JWT verification (edge) ---
const USER_JWKS_URL = process.env.USER_JWKS_URL || "";
const USER_JWT_ISSUER = process.env.USER_JWT_ISSUER || "";
const USER_JWT_AUDIENCE = process.env.USER_JWT_AUDIENCE || "";
const CLOCK_SKEW = Number(process.env.USER_JWT_CLOCK_SKEW_SEC || "60");

// jose is ESM-only; gateway compiles to CJS. Use cached dynamic import everywhere.
let __jose__: Promise<typeof import("jose")> | null = null;
function getJose() {
  return (__jose__ ??= import("jose"));
}

// Remote JWKS cache (created via jose once)
let userJwks: ReturnType<
  Awaited<typeof import("jose")>["createRemoteJWKSet"]
> | null = null;

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

    // ────────────────────── Health bypass (maintainability) ──────────────────────
    // Health endpoints are mounted before auth in workers; allow them through
    // the gateway without requiring user tokens or policy entries.
    if (method === "GET" && /^\/v\d+\/health$/.test(normPath)) {
      return next();
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Fetch config + policy for {slug, major}
    const cfg: SvcConfig = await fetchSvcConfig(slug, major);
    const rule = matchRule(method, normPath, cfg.policy.rules);

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
