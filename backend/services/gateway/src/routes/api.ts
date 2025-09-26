// backend/services/gateway/src/routes/api.ts
/**
 * WHY:
 * - Minimal router for /api/<slug>.<Vx>/<rest>.
 * - Parses slug/version/rest once; handler does the S2S via shared.
 * - Add a **scoped JSON parser** so request bodies are materialized
 *   (callBySlug is not a streaming proxy).
 */
import express, { Router } from "express";
import { forwardToService } from "../handlers/forwardToService";
import { enforceRoutePolicy } from "../middleware/enforceRoutePolicy";

// Explicit type annotation prevents deep type inference that breaks with node16/nodenext
const api: Router = Router();

/**
 * Scoped body parsing for versioned API only.
 * - Keep it narrow: JSON only, reasonable limit.
 * - No global parsers in app.ts (preserve zero-copy elsewhere).
 */
api.use("/:slug.:version/*", express.json({ limit: "2mb" }));

// Parse "/api/<slug>.<Vx>/<rest...>" and enforce route policy before forwarding
api.all(
  "/:slug.:version/*",
  (req, _res, next) => {
    const slug = String(req.params.slug || "").toLowerCase();
    const version = String(req.params.version || ""); // expect V1/v1

    // Remainder after "<slug>.<version>/"
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
