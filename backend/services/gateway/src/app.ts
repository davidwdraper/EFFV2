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
  requireUpstreamByKey,
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
const ACT_URL = requireUpstreamByKey("ACT_SERVICE_URL");
const readiness: ReadinessFn = async (_req) => {
  try {
    const r = await axios.get(`${ACT_URL}/health/ready`, {
      timeout: 1500,
      validateStatus: () => true,
    });
    return { upstreams: { act: { ok: r.status === 200, url: ACT_URL } } };
  } catch {
    return { upstreams: { act: { ok: false, url: ACT_URL } } };
  }
};

app.use(
  "/",
  createHealthRouter({
    service: serviceName,
    readiness,
  })
);

// 👀 DEBUG: introspection endpoints (remove before release)
app.get("/__core", (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    ENV_FILE: process.env.ENV_FILE,
  });
});
app.get("/__auth", (_req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    // Client auth
    CLIENT_AUTH_REQUIRE: process.env.CLIENT_AUTH_REQUIRE ?? null,
    CLIENT_AUTH_BYPASS: process.env.CLIENT_AUTH_BYPASS ?? null,
    CLIENT_AUTH_JWKS_URL: process.env.CLIENT_AUTH_JWKS_URL || null,
    CLIENT_AUTH_ISSUERS: process.env.CLIENT_AUTH_ISSUERS || null,
    CLIENT_AUTH_AUDIENCE: process.env.CLIENT_AUTH_AUDIENCE || null,
    CLIENT_AUTH_CLOCK_SKEW_SEC: process.env.CLIENT_AUTH_CLOCK_SKEW_SEC || null,
    // S2S
    S2S_SECRET_PRESENT: !!(
      process.env.S2S_SECRET && process.env.S2S_SECRET.length > 0
    ),
    S2S_ISSUER: process.env.S2S_ISSUER || null,
    S2S_AUDIENCE: process.env.S2S_AUDIENCE || null,
    S2S_MAX_TTL_SEC: process.env.S2S_MAX_TTL_SEC || null,
    // Proxy pathing
    INBOUND_STRIP_SEGMENTS: process.env.INBOUND_STRIP_SEGMENTS ?? null,
    OUTBOUND_API_PREFIX: process.env.OUTBOUND_API_PREFIX ?? null,
  });
});

// Limits + timeouts + breaker + auth (none consume request body)
app.use(rateLimitMiddleware(rateLimitCfg));
app.use(sensitiveLimiter());
app.use(timeoutsMiddleware(timeoutCfg));
app.use(circuitBreakerMiddleware(breakerCfg));
app.use(authGate());

// Public root
app.get("/", (_req, res) => res.type("text/plain").send("gateway is up"));

// ──────────────────────────────────────────────────────────────────────────────
// Service proxy plane — MUST be before any body parsers
app.use(serviceProxy());

// ──────────────────────────────────────────────────────────────────────────────
// Only after the proxy do we parse bodies for NON-proxied routes (admin, debug)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// 404 + error handlers
app.use(notFoundHandler());
app.use(errorHandler());

export default app;
