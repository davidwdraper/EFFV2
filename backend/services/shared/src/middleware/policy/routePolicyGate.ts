// backend/services/shared/src/middleware/policy/routePolicyGate.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0031 — Route Policy Gate at Gateway & Facilitator Endpoints
 * - ADR-0032-route-policy-gate
 * - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Shared middleware that enforces route-level access defaults
 *   and provides minAccessLevel metadata to downstream token validation gates.
 *
 * Rules:
 *  1) TTL cache on (cacheKey, method, path); negative-cache too.
 *  2) Save minAccessLevel for the token validation gate (0 if no policy).
 *  3) No JWT & no policy → 401.
 *  4) No JWT & policy → 401 unless minAccessLevel === 0 (public).
 *  5) JWT & no policy → allow (validation next gate).
 *  6) JWT & policy → allow; next gate enforces userType ≥ minAccessLevel.
 *
 * Invariants:
 * - Environment invariance: all URLs/TTLs injected via opts.
 * - Single concern: discovery + basic gate only.
 * - Cache key is version-agnostic; facilitator GET may require version.
 * - Health routes automatically bypass enforcement.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { IBoundLogger } from "../../logger/Logger";
import type { ISvcconfigResolver } from "../../s2s/SvcClient";

type HttpMethod = "PUT" | "POST" | "PATCH" | "GET" | "DELETE";

type CacheEntry =
  | { found: true; minAccessLevel: number; exp: number }
  | { found: false; exp: number };

declare global {
  namespace Express {
    interface Request {
      routePolicyMinAccessLevel?: number;
      routePolicyFound?: boolean;
    }
  }
}

/** Options injected from AppBase / service bootstrap. */
export interface RoutePolicyGateOpts {
  /** Bound structured logger (ADR-0031). */
  logger: IBoundLogger;

  /**
   * Canonical env label for THIS process (e.g., "dev", "stage", "prod").
   * REQUIRED: middleware must not guess env.
   */
  envLabel: string;

  /** Facilitator base URL (e.g., from SVCFACILITATOR_BASE_URL). */
  facilitatorBaseUrl: string;

  /** Route-policy cache TTL in ms (default ≈5000). */
  ttlMs: number;

  /**
   * Resolver used to map env+slug+version → target.
   *
   * Note:
   * - This middleware MUST NOT depend on internal persistence identifiers
   *   (e.g., svcconfigId). It uses service identity only.
   */
  resolver: ISvcconfigResolver;

  /** Optional fetch timeout (ms, default 5000). */
  fetchTimeoutMs?: number;

  /** Optional service name for log context. */
  serviceName?: string;
}

export function routePolicyGate(opts: RoutePolicyGateOpts): RequestHandler {
  const {
    logger,
    envLabel,
    facilitatorBaseUrl,
    ttlMs,
    resolver,
    fetchTimeoutMs = 5000,
    serviceName = "unknown",
  } = opts;

  if (!logger) throw new Error("[routePolicyGate] logger required");
  if (!envLabel?.trim()) throw new Error("[routePolicyGate] envLabel required");
  if (!facilitatorBaseUrl?.trim())
    throw new Error("[routePolicyGate] facilitatorBaseUrl required");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new Error("[routePolicyGate] ttlMs must be > 0");

  const env = envLabel.trim();

  const log = logger.bind({
    service: serviceName,
    component: "RoutePolicyGate",
    envLabel: env,
  });

  const cache = new Map<string, CacheEntry>();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Always bypass health endpoints
      if (req.path.includes("/health")) return next();

      const bearer = hasBearer(req);

      log.debug(
        { url: req.originalUrl, method: req.method, bearer },
        "route_policy_enter"
      );

      const { slug, version, method, path } = parseApiRequest(req);

      // Route policy gate is only meaningful for services that are resolvable.
      // We do NOT depend on svcconfigId (internal persistence detail); we only
      // need to know whether the target exists for (env, slug, version).
      try {
        await resolver.resolveTarget(env, slug, version);
      } catch {
        attachPolicy(req, { found: false, min: 0 });

        if (!bearer) {
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

      // Cache key MUST include env (publish safety); remains version-agnostic by design.
      const key = cacheKey(env, slug, method, path);
      let entry = cache.get(key);

      if (!entry || isExpired(entry)) {
        entry = await fetchPolicy(facilitatorBaseUrl, {
          envLabel: env,
          slug,
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

      if (!bearer && !entry.found) {
        log.info(
          { method, path, slug, reason: "private_by_default_no_policy" },
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
            slug,
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
          slug,
          found: entry.found,
          minAccessLevel: entry.found ? entry.minAccessLevel : 0,
          bearer,
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

// ──────────────────────────────── Internals ────────────────────────────────

function cacheKey(
  envLabel: string,
  slug: string,
  method: HttpMethod,
  normPath: string
): string {
  // Publish-safe: env MUST be part of the key.
  // Version-agnostic by explicit invariant.
  return `${envLabel}|${slug}|${method}|${normPath}`;
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
    envLabel: string;
    slug: string;
    version: number;
    method: HttpMethod;
    path: string;
    timeoutMs: number;
    log: IBoundLogger;
  }
): Promise<CacheEntry> {
  const { envLabel, slug, version, method, path, timeoutMs, log } = args;

  // Contract MUST be identity-based for publish-safety:
  // envLabel + slug + version, not svcconfigId.
  const url =
    `${facilitatorBaseUrl.replace(
      /\/$/,
      ""
    )}/api/svcfacilitator/v1/routePolicy` +
    `?env=${encodeURIComponent(envLabel)}` +
    `&slug=${encodeURIComponent(slug)}` +
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
