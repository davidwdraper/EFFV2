// backend/services/gateway/src/middleware/routePolicyGate.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0031 — Route Policy Gate at Gateway & Facilitator Endpoints
 * - ADR-0032-route-policy-gate
 * - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Gateway edge middleware that enforces route-level access defaults
 *   and provides minAccessLevel to the token validation gate.
 *
 * Rules:
 *  1) TTL cache on (svcconfigId, method, path); negative-cache too.
 *  2) Save minAccessLevel for the token validation gate (0 if no policy).
 *  3) No JWT & no policy → 401.
 *  4) No JWT & policy → 401 unless minAccessLevel === 0 (public).
 *  5) JWT & no policy → allow (validation next gate).
 *  6) JWT & policy → allow; next gate enforces userType ≥ minAccessLevel.
 *
 * Invariants:
 * - Environment invariance: no literals; all URLs/TTL are DI’d via opts.
 * - Single concern: discovery + basic gate only.
 * - Cache key is version-agnostic; facilitator GET may require version.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { IBoundLogger } from "@nv/shared/logger/Logger"; // canonical logger type

export interface ISvcconfigResolver {
  /** Returns the parent svcconfig ObjectId (24-hex string) for a given slug@version, or null if unknown. */
  getSvcconfigId(slug: string, version: number): string | null;
}

type HttpMethod = "PUT" | "POST" | "PATCH" | "GET" | "DELETE";

type CacheEntry =
  | { found: true; minAccessLevel: number; exp: number }
  | { found: false; exp: number };

type BindLog = (ctx: Record<string, unknown>) => IBoundLogger;

declare global {
  namespace Express {
    interface Request {
      routePolicyMinAccessLevel?: number;
      routePolicyFound?: boolean;
    }
  }
}

export type RoutePolicyGateOpts = {
  bindLog: BindLog;
  facilitatorBaseUrl: string;
  ttlMs: number;
  resolver: ISvcconfigResolver;
  fetchTimeoutMs?: number;
};

export function routePolicyGate(opts: RoutePolicyGateOpts): RequestHandler {
  const {
    bindLog,
    facilitatorBaseUrl,
    ttlMs,
    resolver,
    fetchTimeoutMs = 5000,
  } = opts;

  if (typeof bindLog !== "function")
    throw new Error("[routePolicyGate] bindLog required");
  if (!facilitatorBaseUrl?.trim())
    throw new Error("[routePolicyGate] facilitatorBaseUrl required");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new Error("[routePolicyGate] ttlMs must be > 0");

  const log = bindLog({ service: "gateway", component: "RoutePolicyGate" });
  const cache = new Map<string, CacheEntry>();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      log.debug(
        { url: req.originalUrl, method: req.method },
        "route_policy_enter"
      );

      const { slug, version, method, path } = parseApiRequest(req);

      // Resolve svcconfigId using slug@version (mirror is versioned)
      const svcconfigId = resolver.getSvcconfigId(slug, version);
      if (!svcconfigId) {
        attachPolicy(req, { found: false, min: 0 });
        if (!hasBearer(req)) {
          log.info(
            {
              slug,
              version,
              method,
              path,
              reason: "service_unknown_and_no_token",
            },
            "route_policy_denied"
          );
          return respond(
            res,
            401,
            "unauthorized",
            "service_unknown_and_no_token"
          );
        }
        log.debug(
          {
            slug,
            version,
            method,
            path,
            reason: "service_unknown_but_token_present",
          },
          "route_policy_allow_with_token_service_unknown"
        );
        return next();
      }

      const key = cacheKey(svcconfigId, method, path);
      let entry = cache.get(key);

      if (!entry || isExpired(entry)) {
        entry = await fetchPolicy(facilitatorBaseUrl, {
          svcconfigId,
          version,
          method,
          path,
          timeoutMs: fetchTimeoutMs,
          log,
        });
        cache.set(key, entry);
      }

      attachPolicy(
        req,
        entry.found
          ? { found: true, min: entry.minAccessLevel }
          : { found: false, min: 0 }
      );

      const bearer = hasBearer(req);

      if (!bearer && !entry.found) {
        log.info(
          { method, path, svcconfigId, reason: "private_by_default_no_policy" },
          "route_policy_denied"
        );
        return respond(
          res,
          401,
          "unauthorized",
          "private_by_default_no_policy"
        );
      }

      if (!bearer && entry.found && entry.minAccessLevel > 0) {
        log.info(
          {
            method,
            path,
            svcconfigId,
            minAccessLevel: entry.minAccessLevel,
            reason: "policy_requires_token",
          },
          "route_policy_denied"
        );
        return respond(res, 401, "unauthorized", "policy_requires_token");
      }

      log.debug(
        {
          method,
          path,
          svcconfigId,
          found: entry.found,
          minAccessLevel: entry.found ? entry.minAccessLevel : 0,
          bearer: true,
        },
        "route_policy_pass_to_token_gate"
      );
      return next();
    } catch (err) {
      log.error(
        {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : { message: String(err) },
        },
        "route_policy_gate_error"
      );
      return respond(res, 502, "bad_gateway", "route_policy_resolution_failed");
    }
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

function cacheKey(
  svcconfigId: string,
  method: HttpMethod,
  normPath: string
): string {
  return `${svcconfigId}|${method}|${normPath}`;
}

function isExpired(entry: CacheEntry): boolean {
  return Date.now() >= entry.exp;
}

function attachPolicy(
  req: Request,
  info: { found: true; min: number } | { found: false; min: 0 }
): void {
  req.routePolicyFound = info.found;
  req.routePolicyMinAccessLevel = info.min;
}

function hasBearer(req: Request): boolean {
  const h = (req.headers["authorization"] || req.headers["Authorization"]) as
    | string
    | undefined;
  if (!h) return false;
  return /^Bearer\s+.+/i.test(h.trim());
}

function parseApiRequest(req: Request): {
  slug: string;
  version: number;
  method: HttpMethod;
  path: string;
} {
  const original = req.originalUrl || req.url || "";
  const m = original.match(/^\/api\/([^/]+)\/v(\d+)(?:\/(.*))?$/i);
  if (!m) throw new Error(`invalid_api_path: ${original}`);
  const slug = m[1].toLowerCase();
  const version = Number(m[2]);
  const rest = m[3] ?? "";
  const path = normalizePath("/" + rest);
  const method = req.method.toUpperCase() as HttpMethod;
  if (!["PUT", "POST", "PATCH", "GET", "DELETE"].includes(method))
    throw new Error(`unsupported_method: ${method}`);
  return { slug, version, method, path };
}

function normalizePath(input: string): string {
  let p = (input || "").trim();
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h >= 0) p = p.slice(0, h);
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

async function fetchPolicy(
  facilitatorBaseUrl: string,
  args: {
    svcconfigId: string;
    version: number;
    method: HttpMethod;
    path: string;
    timeoutMs: number;
    log: IBoundLogger;
  }
): Promise<CacheEntry> {
  const { svcconfigId, version, method, path, timeoutMs, log } = args;
  const url =
    `${facilitatorBaseUrl.replace(
      /\/$/,
      ""
    )}/api/svcfacilitator/v1/routePolicy` +
    `?svcconfigId=${encodeURIComponent(svcconfigId)}` +
    `&version=${encodeURIComponent(String(version))}` +
    `&method=${encodeURIComponent(method)}` +
    `&path=${encodeURIComponent(path)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    } as RequestInit);

    const text = await resp.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      log.warn({ url, text }, "route_policy_non_json");
      return { found: false, exp: Date.now() + timeoutMs };
    }

    if (!resp.ok || json?.ok !== true) {
      log.warn({ url, status: resp.status, json }, "route_policy_http_problem");
      return { found: false, exp: Date.now() + timeoutMs };
    }

    const policy = json?.data?.policy;
    if (!policy)
      return { found: false, exp: Date.now() + ttlFrom(json, timeoutMs) };

    const min = Number(policy.minAccessLevel ?? 0);
    const ttl = ttlFrom(json, timeoutMs);
    return {
      found: true,
      minAccessLevel: Number.isFinite(min) ? min : 0,
      exp: Date.now() + ttl,
    };
  } catch (e) {
    log.warn({ url, err: String(e) }, "route_policy_fetch_error");
    return { found: false, exp: Date.now() + timeoutMs };
  } finally {
    clearTimeout(timer);
  }
}

function ttlFrom(_json: any, defaultTtl: number): number {
  return defaultTtl;
}

function respond(
  res: Response,
  status: number,
  title: string,
  detailCode: string
): Response {
  res.status(status);
  return res.json({ type: "about:blank", title, status, detail: detailCode });
}
