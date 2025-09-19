// backend/services/gateway/src/middleware/resolveServiceFromSlug.ts
/**
 * --------------------------------------------------------------------------
 * resolveServiceFromSlug middleware (svcconfig-backed)
 * --------------------------------------------------------------------------
 * Purpose:
 *   Map /api/:slug.V<version>/... to the internal worker base URL using
 *   svcconfig, and compute the final upstream target URL without introducing
 *   slashes bugs.
 *
 * Behavior:
 *   - Requires slug with explicit API version: "<slug>.V<version>" (APR-0029).
 *   - Looks up the service by (slug, version) in svcconfig snapshot.
 *   - Uses svc.baseUrl (trimmed) and svc.outboundApiPrefix (default "/api").
 *   - Strips the "/api/:slug.V<version>" prefix from the incoming URL to get the remainder.
 *   - Joins baseUrl + outboundApiPrefix + remainder with safe joining.
 *   - Attaches { slug, version, baseUrl, apiPrefix, targetUrl } to req.resolvedService.
 *
 * Notes:
 *   - This middleware **does not** decide public vs private proxying;
 *     it always uses *internal* resolution for gateway→worker hops.
 *   - If svc is missing/disabled or version not found, returns 404.
 *
 * ADRs:
 *   - docs/adr/0029-versioned-s2s-and-x-nv-api-version.md
 */

import type { Request, Response, NextFunction } from "express";
import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";

/** Safe join for URL base + path (avoids double slashes). */
function joinUrl(base: string, path: string): string {
  const b = (base || "").replace(/\/+$/, "");
  const p = String(path || "");
  return p.startsWith("/") ? `${b}${p}` : `${b}/${p}`;
}

export default function resolveServiceFromSlug(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Expect routes mounted as /api/:slug/...
  // Here ":slug" MUST be "<slug>.V<version>" (case-insensitive V).
  const slugParam = (req.params as any)?.slug as string | undefined;
  if (!slugParam) {
    return res.status(404).json({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Missing service slug in route.",
      instance: (req as any).id,
    });
  }

  const m = /^([a-z0-9-]+)\.v(\d+)$/i.exec(slugParam.trim());
  if (!m) {
    return res.status(404).json({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail:
        "Service slug must include an API version, e.g. /api/act.V1/acts (.../slug.V<version>/...).",
      instance: (req as any).id,
    });
  }
  const slug = m[1].toLowerCase();
  const versionNum = Number(m[2]);
  const versionKey = String(versionNum);

  // Read svcconfig snapshot (no network calls here)
  const snap = getSvcconfigSnapshot();
  const byVersion =
    (snap?.services?.[slug] as Record<string, any> | undefined) || undefined;
  const svc = byVersion?.[versionKey];

  if (!svc || svc.enabled !== true) {
    return res.status(404).json({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: `Service '${slug}' (version v${versionKey}) unavailable (unknown or disabled).`,
      instance: (req as any).id,
    });
  }

  const baseUrl = String(svc.baseUrl || "").replace(/\/+$/, "");
  const apiPrefix = String(svc.outboundApiPrefix || "/api").replace(
    /^\/?/,
    "/"
  );

  // Compute remainder after "/api/:slug.V<version>"
  const mount = req.baseUrl || `/api/${slugParam}`;
  const full = req.originalUrl || req.url || "/";
  const remainder = full.startsWith(mount)
    ? full.slice(mount.length) || "/"
    : "/";

  if (!remainder.startsWith("/")) {
    return res.status(502).json({
      type: "about:blank",
      title: "Bad Gateway",
      status: 502,
      detail:
        "Route remainder missing after versioned slug; expected plural resource.",
      instance: (req as any).id,
    });
  }

  // Compose: base + apiPrefix + remainder  → e.g., http://...:4002 + /api + /acts
  const baseWithPrefix = joinUrl(baseUrl, apiPrefix);
  const targetUrl = joinUrl(baseWithPrefix, remainder);

  (req as any).resolvedService = {
    slug,
    version: versionNum,
    baseUrl,
    apiPrefix,
    targetUrl,
  };

  // Minimal debug without leaking secrets
  (req as any).log?.debug?.({
    msg: "[gateway] resolved",
    slug,
    version: versionNum,
    baseUrl,
    apiPrefix,
    remainder,
    targetUrl,
  });

  return next();
}
