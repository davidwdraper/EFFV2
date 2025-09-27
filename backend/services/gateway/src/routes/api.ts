// backend/services/gateway/src/routes/api.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0016-standard-health-and-readiness-endpoints.md
 *   - docs/adr/0032-route-policy-via-svcconfig-and-ctx-hop-tokens.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *
 * WHY:
 * - Minimal router for /api/<slug>.<Vx>/<rest>.
 * - Parses slug/version/rest once; handler does the S2S via shared.
 * - Scoped JSON parser only for versioned API routes.
 */
import express, { Router } from "express";
import { forwardToService } from "../handlers/forwardToService";
import { enforceRoutePolicy } from "../middleware/enforceRoutePolicy";

const api: Router = Router();

api.use("/:slug.:version/*", express.json({ limit: "2mb" }));

api.all(
  "/:slug.:version/*",
  (req, _res, next) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const version = String(req.params.version || "");
    const idx = req.path.indexOf(`${slug}.${version}/`);
    const restPath =
      idx >= 0 ? req.path.slice(idx + `${slug}.${version}/`.length) : "";
    (req as any).parsedApiRoute = { slug, version, restPath };
    next();
  },
  enforceRoutePolicy,
  forwardToService
);

export default api;
