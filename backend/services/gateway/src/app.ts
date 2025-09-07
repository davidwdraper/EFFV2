// backend/services/gateway/src/app.ts
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import axios from "axios";
import { randomUUID } from "crypto";
import helmet from "helmet";
import { createHealthRouter, ReadinessFn } from "@shared/health";
import { logger } from "@shared/utils/logger";

import {
  serviceName,
  rateLimitCfg,
  timeoutCfg,
  breakerCfg,
  ROUTE_ALIAS,
} from "./config";

import { requestIdMiddleware } from "./middleware/requestId";
import {
  problemJsonMiddleware,
  notFoundHandler,
  errorHandler,
} from "./middleware/problemJson";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { timeoutsMiddleware } from "./middleware/timeouts";
import { circuitBreakerMiddleware } from "./middleware/circuitBreaker";
import { authGate } from "./middleware/authGate";
import { sensitiveLimiter } from "./middleware/sensitiveLimiter";
import { httpsOnly } from "./middleware/httpsOnly";
import { serviceProxy } from "./middleware/serviceProxy";
import { trace5xx } from "./middleware/trace5xx";
import { injectUpstreamIdentity } from "./middleware/injectUpstreamIdentity";

// ✅ Shared svcconfig client (same as core)
import {
  startSvcconfigMirror,
  getSvcconfigSnapshot,
} from "@shared/svcconfig/client";
import type { ServiceConfig } from "@shared/contracts/svcconfig.contract";

// Kick off svcconfig mirror (ETag-aware; Redis/poll handled inside shared)
void startSvcconfigMirror();

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
function sanitizeUrl(u: string): string {
  try {
    const [path, qs] = u.split("?", 2);
    const p = path
      .replace(/(\/users\/email\/)[^/]+/i, "$1<redacted>")
      .replace(/(\/users\/private\/email\/)[^/]+/i, "$1<redacted>");
    return qs ? `${p}?${qs}` : p;
  } catch {
    return u;
  }
}

// Alias + singularize to canonical slug (matches previous behavior)
function resolveSlug(seg: string): string {
  const lower = String(seg || "").toLowerCase();
  const aliased = (ROUTE_ALIAS as Record<string, string>)[lower] || lower;
  return aliased.endsWith("s") ? aliased.slice(0, -1) : aliased;
}

// Lookup service by incoming path segment with allow/enable checks
function getServiceBySegment(seg: string): ServiceConfig | undefined {
  const snap = getSvcconfigSnapshot();
  if (!snap) return undefined;
  const slug = resolveSlug(seg);
  const cfg = snap.services[slug];
  if (!cfg) return undefined;
  if (!cfg.enabled) return undefined;
  if (!cfg.allowProxy) return undefined;
  return cfg;
}

// Compute upstream health URL (if exposed)
function healthUrlFor(seg: string, kind: "live" | "ready"): string | null {
  const cfg = getServiceBySegment(seg);
  if (!cfg || cfg.exposeHealth === false) return null;
  const healthRoot = (cfg.healthPath || "/health").replace(/\/+$/, "");
  return `${cfg.baseUrl.replace(/\/+$/, "")}${healthRoot}/${kind}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// App
export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

// HTTPS policy: prod/stage only (dev/local sets FORCE_HTTPS=false)
app.use(httpsOnly());
if (process.env.FORCE_HTTPS === "true") {
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true }));
}

// CORS early (does not consume body)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-request-id",
      "x-correlation-id",
      "x-amzn-trace-id",
      // 🔐 allow internal user assertion header through CORS preflight
      "x-nv-user-assertion",
    ],
  })
);

// ❗ No body parsers before proxy — keep raw stream intact.

// Request ID first
app.use(requestIdMiddleware());

// pino-http logger (bind service)
const httpLogger = logger.child({ service: serviceName });
app.use(
  pinoHttp({
    logger: httpLogger,
    customLogLevel(_req, res, err) {
      if (err) return "error";
      const s = res.statusCode;
      if (s >= 500) return "error";
      if (s >= 400) return "warn";
      return "info";
    },
    genReqId: (req, res) => {
      const hdr =
        req.headers["x-request-id"] ||
        req.headers["x-correlation-id"] ||
        req.headers["x-amzn-trace-id"];
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
      res.setHeader("x-request-id", String(id));
      return String(id);
    },
    customProps(req) {
      return { reqId: (req as any).id };
    },
    autoLogging: {
      ignore: (req) =>
        req.url === "/health" ||
        req.url === "/health/live" ||
        req.url === "/health/ready" ||
        req.url === "/healthz" ||
        req.url === "/readyz" ||
        req.url === "/live" ||
        req.url === "/ready" ||
        req.url === "/favicon.ico" ||
        req.url === "/__core" ||
        req.url === "/__auth",
    },
    serializers: {
      req(req) {
        return {
          id: (req as any).id,
          method: req.method,
          url: sanitizeUrl(req.url),
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
    redact: { paths: [], remove: true },
  })
);

// Problem+JSON envelope (does not consume request body)
app.use(problemJsonMiddleware());

// Trace where any 5xx is set (before guards/proxy)
app.use(trace5xx("early"));

// ──────────────────────────────────────────────────────────────────────────────
// Health / Readiness — BEFORE limits/auth

const readiness: ReadinessFn = async (_req) => {
  const must = ["user", "act"]; // adjust as needed
  const upstreams: Record<string, { ok: boolean; url?: string }> = {};

  await Promise.all(
    must.map(async (slug) => {
      try {
        const h = healthUrlFor(slug, "ready");
        if (!h) {
          upstreams[slug] = { ok: false };
          return;
        }
        const r = await axios.get(h, {
          timeout: 1500,
          validateStatus: () => true,
        });
        upstreams[slug] = { ok: r.status === 200, url: h };
      } catch {
        upstreams[slug] = { ok: false };
      }
    })
  );

  return { upstreams };
};

app.use(
  "/",
  createHealthRouter({
    service: serviceName,
    readiness,
  })
);

// Public dynamic health passthroughs (NO /api, NO auth, NO Authorization)
app.get("/:svc/health/:kind(live|ready)", async (req, res) => {
  try {
    delete req.headers.authorization;
    const url = healthUrlFor(
      String(req.params.svc || ""),
      req.params.kind as "live" | "ready"
    );
    if (!url) {
      return res.status(404).json({
        code: "NOT_FOUND",
        status: 404,
        message: "Service not found or health not exposed",
      });
    }
    const r = await axios.get(url, {
      timeout: 1500,
      validateStatus: () => true,
      headers: { "x-request-id": String((req as any).id || "") },
    });
    return res.status(r.status).set(r.headers).send(r.data);
  } catch {
    return res.status(502).json({
      code: "BAD_GATEWAY",
      status: 502,
      message: "Upstream health unavailable",
    });
  }
});

// 👀 DEBUG: introspection endpoints
app.get("/__core", (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    ENV_FILE: process.env.ENV_FILE,
  });
});
app.get("/__auth", (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    CLIENT_AUTH_REQUIRE: process.env.CLIENT_AUTH_REQUIRE ?? null,
    CLIENT_AUTH_BYPASS: process.env.CLIENT_AUTH_BYPASS ?? null,
    CLIENT_AUTH_JWKS_URL: process.env.CLIENT_AUTH_JWKS_URL || null,
    CLIENT_AUTH_ISSUERS: process.env.CLIENT_AUTH_ISSUERS || null,
    CLIENT_AUTH_AUDIENCE: process.env.CLIENT_AUTH_AUDIENCE || null,
    CLIENT_AUTH_CLOCK_SKEW_SEC: process.env.CLIENT_AUTH_CLOCK_SKEW_SEC || null,
    S2S_SECRET_PRESENT: !!(
      process.env.S2S_SECRET && process.env.S2S_SECRET.length > 0
    ),
    S2S_ISSUER: process.env.S2S_ISSUER || null,
    S2S_AUDIENCE: process.env.S2S_AUDIENCE || null,
    INBOUND_STRIP_SEGMENTS: process.env.INBOUND_STRIP_SEGMENTS ?? null,
    OUTBOUND_API_PREFIX: process.env.OUTBOUND_API_PREFIX ?? null,
    USER_ASSERTION_SECRET_PRESENT: !!(
      process.env.USER_ASSERTION_SECRET &&
      process.env.USER_ASSERTION_SECRET.length > 0
    ),
    USER_ASSERTION_AUDIENCE: process.env.USER_ASSERTION_AUDIENCE || null,
    USER_ASSERTION_TTL_SEC: process.env.USER_ASSERTION_TTL_SEC || null,
    USER_ASSERTION_CLOCK_SKEW_SEC:
      process.env.USER_ASSERTION_CLOCK_SKEW_SEC || null,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Limits + timeouts + breaker + auth
app.use(rateLimitMiddleware(rateLimitCfg));
app.use(sensitiveLimiter());
app.use(timeoutsMiddleware(timeoutCfg));
app.use(circuitBreakerMiddleware(breakerCfg));
app.use(authGate());

// Public root
app.get("/", (_req, res) => res.type("text/plain").send("gateway is up"));

// ──────────────────────────────────────────────────────────────────────────────
// ── Service proxy plane ──
// Inject gateway-issued identity for all upstream worker calls
app.use("/api", injectUpstreamIdentity());
app.use("/api", serviceProxy());

// ──────────────────────────────────────────────────────────────────────────────
// Only after the proxy do we parse bodies for NON-proxied routes
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// 404 + error handlers
app.use(notFoundHandler());
app.use(errorHandler());

export default app;
