// backend/services/gateway/src/routes/proxy.router.ts
/**
 * NowVibin (NV)
 * File: backend/services/gateway/src/routes/proxy.router.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0003 (Gateway pulls svc map from svcfacilitator)
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - ADR-0033 (+ addendum): internalOnly services not mirrored to gateway
 *
 * Purpose:
 * - Router layer for proxy: matches /api/* (except /api/gateway/*) and delegates to controller.
 * - Adds a **single, surgical** health fallback:
 *   If a service is **not** in the gateway svcconfig mirror **and** the path is a versioned
 *   health endpoint, resolve the target via svcfacilitator **on-demand** and proxy the health
 *   response directly. Otherwise, fall through to the normal proxy controller.
 *
 * Invariants:
 * - No literals for addresses/ports; facilitator origin/prefix inferred from env.
 * - Only GET /api/<slug>/v<ver>/health[/live|/ready] paths trigger the fallback.
 * - If resolution fails, we **do not** alter behavior — we fall through to the controller.
 */

import type { Request, Response, NextFunction } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { ProxyController } from "../controllers/proxy.controller";
import type { SvcConfig } from "../services/svcconfig/SvcConfig";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import { healthResolveTarget } from "../proxy/health/healthResolveTarget";

export class ProxyRouter extends RouterBase {
  private readonly controller: ProxyController;
  private readonly svccfg: SvcConfig;

  constructor(svccfg: SvcConfig) {
    super({ service: "gateway", context: { router: "proxy" } });
    this.controller = new ProxyController(svccfg);
    this.svccfg = svccfg;
  }

  protected preRoute(): void {
    // Health fallback: only for versioned health when svc not present in gateway mirror.
    this.use(async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (req.method !== "GET") return next();

        // Parse versioned API path; if not versioned, let controller handle it.
        let slug: string,
          version: number,
          subpath = "/";
        try {
          const addr = UrlHelper.parseApiPath(req.originalUrl);
          slug = addr.slug?.toLowerCase();
          version = addr.version;
          subpath = addr.subpath || "/";
        } catch {
          return next();
        }

        // Only intercept health routes
        if (!isHealthSubpath(subpath)) return next();

        // If the gateway mirror already has the record, let normal proxy handle it.
        const rec = (this.svccfg as any)?.getRecord?.(slug, version);
        if (rec) return next();

        // Otherwise, resolve via facilitator on-demand (existing helper).
        const resolved = await healthResolveTarget(req.originalUrl, req.method);
        if (!resolved) return next();

        // Compose the outbound base using facilitator-derived baseUrl and the shared API prefix.
        const outboundApiPrefix = derivePrefixFromConfigPath();
        const composedBase =
          stripTrailingSlash(resolved.baseUrl) +
          outboundApiPrefix +
          `/${slug}/v${version}`;

        // Proxy the health request directly (GET only, no body).
        const targetUrl =
          normalizeJoin(composedBase, subpath) + buildQuery(req);
        const headers: Record<string, string> = {
          accept: "application/json",
          "x-service-name": "gateway",
        };
        // Preserve request id if present
        const rid =
          req.get("x-request-id") ||
          req.get("x-correlation-id") ||
          req.get("request-id");
        if (rid) headers["x-request-id"] = rid;

        const upstream = await fetch(targetUrl, { method: "GET", headers });

        // Stream status + selected headers + body back to client.
        res.status(upstream.status);
        upstream.headers.forEach((v, k) => {
          const key = k.toLowerCase();
          if (key === "transfer-encoding" || key === "connection") return;
          if (key === "content-type" || key.startsWith("x-")) {
            res.setHeader(k, v);
          }
        });

        const ctype = upstream.headers.get("content-type") || "";
        if (ctype.includes("application/json")) {
          const json = await upstream.json().catch(() => ({}));
          return res.json(json);
        } else {
          const text = await upstream.text().catch(() => "");
          return res.send(text);
        }
      } catch {
        // Any failure here should not change behavior — defer to controller.
        return next();
      }
    });
  }

  protected configure(): void {
    // Catch-all — the controller handles /api/* (the app mounts us at /api).
    // /api/gateway/* is short-circuited inside the controller (not proxied).
    this.use((req: Request, res: Response, next: NextFunction) =>
      this.controller.handle(req, res, next)
    );
  }

  protected postRoute(): void {
    // Trailing middleware hooks if needed.
  }
}

// ────────────────────────────── helpers (file-local) ──────────────────────────────

/** Accept "/health" or "/health/<token>" (single token), optional trailing "/" */
function isHealthSubpath(subpath: string): boolean {
  const norm = (subpath || "/").replace(/\/+$/, "");
  return /^\/health(?:\/[A-Za-z0-9_-]+)?$/.test(norm);
}

/** Join base + subpath ensuring exactly one slash at the boundary. */
function normalizeJoin(base: string, subpath: string): string {
  const b = stripTrailingSlash(base);
  const s = subpath?.startsWith("/") ? subpath : `/${subpath || ""}`;
  return b + s;
}

/** Remove trailing "/" from a string (safe for empty). */
function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Derive the outbound API prefix from the facilitator config path (e.g., "/api").
 * Mirrors the logic used by healthResolveTarget to avoid literals.
 */
function derivePrefixFromConfigPath(): string {
  const configPath = (
    process.env.SVCFACILITATOR_CONFIG_PATH || "/api/svcfacilitator/v1/svcconfig"
  ).trim();
  if (!configPath.startsWith("/")) {
    throw new Error("SVCFACILITATOR_CONFIG_PATH must start with '/'");
  }
  const anchor = "/svcfacilitator/";
  const idx = configPath.indexOf(anchor);
  if (idx <= 0) {
    throw new Error(
      "SVCFACILITATOR_CONFIG_PATH must contain '/svcfacilitator/' (e.g., /api/svcfacilitator/v1/svcconfig)"
    );
  }
  return configPath.slice(0, idx).replace(/\/+$/, "") || "/";
}

/** Preserve original query string if present. */
function buildQuery(req: Request): string {
  const q = req.url.split("?", 2)[1];
  return q ? `?${q}` : "";
}
