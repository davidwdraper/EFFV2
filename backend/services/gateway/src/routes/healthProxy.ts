/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0016-standard-health-and-readiness-endpoints.md
 *   - docs/adr/0032-route-policy-via-svcconfig-and-ctx-hop-tokens.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Provide PUBLIC, UNVERSIONED health proxy endpoints via the gateway:
 *     GET /api/:slug/health/live
 *     GET /api/:slug/health/ready
 * - Fast-fail on unknown slugs and timeouts. Never hang the socket.
 *
 * Notes:
 * - Uses shared callBySlug() so discovery/auth stay centralized.
 * - Worker health is unversioned; we still stamp X-NV-Api-Version for telemetry.
 */

import { Router, type Request, type Response } from "express";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";

const router: Router = Router();

// Keep short to fail caller-first and avoid smoke-test hangs
const UPSTREAM_TIMEOUT_MS = Number(process.env.HEALTH_PROXY_TIMEOUT_MS ?? 2500);

router.get(
  "/api/:slug/health/:kind(live|ready)",
  async (req: Request, res: Response) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const kind = String(req.params.kind || "live");

    // Cheap slug sanity (avoid path traversal / weird hangs)
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        detail: `Unknown service slug "${slug}"`,
        status: 404,
      });
    }

    try {
      // Health is unversioned at workers; we use V1 as envelope header only
      const resp = await callBySlug<any>(slug, "V1", {
        method: "GET",
        path: `/health/${kind}`, // strip /api/:slug and hit worker directly
        headers: { Accept: "application/json" },
        timeoutMs: UPSTREAM_TIMEOUT_MS,
      });

      const status =
        typeof (resp as any)?.status === "number" ? (resp as any).status : 200;

      const body =
        resp && typeof resp === "object"
          ? resp
          : {
              ok: false,
              service: slug,
              note: "Non-JSON upstream health payload",
            };

      return res.status(status).json(body);
    } catch (err: any) {
      const msg = (err && (err.message || String(err))) || "Upstream error";
      const isTimeout =
        /AbortError|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg) ||
        msg.includes(String(UPSTREAM_TIMEOUT_MS));

      return res.status(isTimeout ? 504 : 502).json({
        type: "about:blank",
        title: isTimeout ? "Gateway Timeout" : "Bad Gateway",
        detail: isTimeout
          ? `Health check to "${slug}" timed out`
          : `Health check to "${slug}" failed: ${msg}`,
        status: isTimeout ? 504 : 502,
      });
    }
  }
);

export default router;
