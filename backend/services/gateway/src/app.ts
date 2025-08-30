// backend/services/gateway/src/app.ts
import express from "express";
import cors from "cors";
import axios from "axios";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import helmet from "helmet";

import { createHealthRouter, ReadinessFn } from "../../shared/health";
import { logger } from "../../shared/utils/logger";

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
// import { genericProxy } from "./middleware/genericProxy"; // ⬅️ REMOVED per SOP
import { httpsOnly } from "./middleware/httpsOnly";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
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
// ──────────────────────────────────────────────────────────────────────────────
export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

// HTTPS policy: prod/stage only (dev/local sets FORCE_HTTPS=false)
app.use(httpsOnly());
if (process.env.FORCE_HTTPS === "true") {
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true })); // ~180d
}

// CORS + body caps
app.use(
  cors({
    // TODO: restrict origin in prod
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
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Request ID first
app.use(requestIdMiddleware());

// pino-http logger
app.use(
  pinoHttp({
    logger,
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
      return { service: serviceName, reqId: (req as any).id };
    },
    autoLogging: {
      ignore: (req) =>
        req.url === "/health" ||
        req.url === "/healthz" ||
        req.url === "/readyz" ||
        req.url === "/favicon.ico",
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

// Problem+JSON envelope
app.use(problemJsonMiddleware());

// Rate limits, timeouts, breaker, auth
app.use(rateLimitMiddleware(rateLimitCfg));
app.use(sensitiveLimiter());
app.use(timeoutsMiddleware(timeoutCfg));
app.use(circuitBreakerMiddleware(breakerCfg));
app.use(authGate());

// Root
app.get("/", (_req, res) => res.type("text/plain").send("gateway is up"));

// ──────────────────────────────────────────────────────────────────────────────
// Health / Readiness
// ──────────────────────────────────────────────────────────────────────────────
const ACT_URL = requireUpstreamByKey("ACT_SERVICE_URL");
const readiness: ReadinessFn = async (_req) => {
  try {
    const r = await axios.get(`${ACT_URL}/healthz`, {
      timeout: 1500,
      validateStatus: () => true,
    });
    return { upstreams: { act: { ok: r.status === 200, url: ACT_URL } } };
  } catch {
    return { upstreams: { act: { ok: false, url: ACT_URL } } };
  }
};

app.use(
  createHealthRouter({
    service: serviceName,
    readiness,
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// No public proxy plane in the external gateway (SOP)
// ──────────────────────────────────────────────────────────────────────────────
// app.use("/api", genericProxy()); // ⬅️ REMOVED
// Optional belt-and-suspenders: make accidental /api hits explicit 404
app.all(/^\/api(\/|$)/, (_req, res) => res.status(404).end());

// 404 + error handlers
app.use(notFoundHandler());
app.use(errorHandler());

export default app;
