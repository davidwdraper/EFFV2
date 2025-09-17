// backend/services/gateway/src/middleware/resolveServiceFromSlug.ts
/**
 * --------------------------------------------------------------------------
 * resolveServiceFromSlug middleware (svcconfig-backed)
 * --------------------------------------------------------------------------
 * Purpose:
 *   Map /api/:slug/... to the internal worker base URL using svcconfig,
 *   and compute the final upstream target URL without introducing slashes bugs.
 *
 * Behavior:
 *   - Looks up the service by slug in svcconfig snapshot.
 *   - Uses svc.baseUrl (trimmed) and svc.outboundApiPrefix (default "/api").
 *   - Strips the "/api/:slug" prefix from the incoming URL to get the remainder.
 *   - Joins baseUrl + outboundApiPrefix + remainder with safe joining.
 *   - Attaches { slug, baseUrl, apiPrefix, targetUrl } to req.resolvedService.
 *
 * Notes:
 *   - This middleware **does not** decide public vs private proxying;
 *     it always uses *internal* resolution for gateway→worker hops.
 *   - If svc is disabled/missing in svcconfig, returns 404.
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
  const slug = (req.params as any)?.slug as string | undefined;
  if (!slug) {
    return res.status(404).json({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Missing service slug in route.",
      instance: (req as any).id,
    });
  }

  // Read svcconfig snapshot (no network calls here)
  const snap = getSvcconfigSnapshot();
  const svc = snap?.services?.[String(slug).toLowerCase()];
  if (!svc || svc.enabled !== true) {
    return res.status(404).json({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: `Service '${slug}' unavailable (unknown or disabled).`,
      instance: (req as any).id,
    });
  }

  const baseUrl = String(svc.baseUrl || "").replace(/\/+$/, "");
  // outboundApiPrefix is required by our routing contract; default to "/api"
  const apiPrefix = String(svc.outboundApiPrefix || "/api").replace(
    /^\/?/,
    "/"
  );

  // Compute remainder after "/api/:slug"
  // Example: originalUrl "/api/act/acts" , baseUrlMount "/api/act" → remainder "/acts"
  const mount = req.baseUrl || `/api/${slug}`;
  const full = req.originalUrl || req.url || "/";
  const remainder = full.startsWith(mount)
    ? full.slice(mount.length) || "/"
    : "/";

  if (!remainder.startsWith("/")) {
    return res.status(502).json({
      type: "about:blank",
      title: "Bad Gateway",
      status: 502,
      detail: "Route remainder missing after slug; expected plural resource.",
      instance: (req as any).id,
    });
  }

  // Compose: base + apiPrefix + remainder  → e.g., http://...:4002 + /api + /acts
  const baseWithPrefix = joinUrl(baseUrl, apiPrefix);
  const targetUrl = joinUrl(baseWithPrefix, remainder);

  (req as any).resolvedService = { slug, baseUrl, apiPrefix, targetUrl };

  // Minimal debug without leaking secrets
  (req as any).log?.debug?.({
    msg: "[gateway] resolved",
    slug,
    baseUrl,
    apiPrefix,
    remainder,
    targetUrl,
  });

  return next();
}
