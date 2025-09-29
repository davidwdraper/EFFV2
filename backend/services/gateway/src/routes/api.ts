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
 * - Minimal router for /api/:slug/:Vx/* (slash between slug and version).
 * - Parses slug/version/rest once; handler does the S2S via shared.
 * - Scoped JSON parser only for versioned API routes.
 */
import express, {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { forwardToService } from "../handlers/forwardToService";
import { enforceRoutePolicy } from "../middleware/enforceRoutePolicy";

const api: Router = Router();

// JSON body limited to versioned API routes only
api.use("/:slug/:version/*", express.json({ limit: "2mb" }));

/** Normalize V-marker: "V1" | "v1" | "1" -> "V1" */
function normalizeVersion(raw: string): string {
  const m = String(raw || "")
    .trim()
    .match(/^v?(\d+)$/i);
  return m ? `V${m[1]}` : "";
}

function parseParams(req: Request, _res: Response, next: NextFunction) {
  const slug = String(req.params.slug || "")
    .trim()
    .toLowerCase();
  const version = normalizeVersion(String(req.params.version || ""));
  const restPath = `/${String((req.params as any)[0] || "").replace(
    /^\/+/,
    ""
  )}`; // Express wildcard

  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    return next(
      Object.assign(new Error(`Unknown service slug "${slug}"`), {
        status: 404,
      })
    );
  }
  if (!/^V\d+$/.test(version)) {
    return next(
      Object.assign(
        new Error(`Invalid version "${req.params.version}" (use V1/V2/...)`),
        { status: 400 }
      )
    );
  }

  (req as any).parsedApiRoute = { slug, version, restPath };
  next();
}

// Correct pattern: /api/:slug/:version/*
api.all("/:slug/:version/*", parseParams, enforceRoutePolicy, forwardToService);

export default api;
