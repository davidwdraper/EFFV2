// backend/services/gateway/src/app.ts

import express from "express";
import cors from "cors";
import axios from "axios";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

import { createHealthRouter, ReadinessFn } from "../../shared/health";
import { logger } from "../../shared/utils/logger";

import actRoutes from "./routes/actRoutes";
import userRoutes from "./routes/userRoutes";
import authRoutes from "./routes/authRoutes";
import imageRoutes from "./routes/imageRoutes";

import {
  serviceName,
  requireUpstream,
  rateLimitCfg,
  timeoutCfg,
  breakerCfg,
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

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function sanitizeUrl(u: string): string {
  try {
    const [path, qs] = u.split("?", 2);
    // Redact email-like path segments to avoid PII in logs
    let p = path
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

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
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
app.use(express.urlencoded({ extended: true }));

// Request ID first (accept/echo; always present)
app.use(requestIdMiddleware());

// pino-http: entry/exit/error with reqId + svc
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
  })
);

// Problem+JSON envelope (RFC 7807)
app.use(problemJsonMiddleware());

// Global rate limit (IP + optional user header)
app.use(rateLimitMiddleware(rateLimitCfg));

// Extra limiter for sensitive read endpoints (e.g., /users/email/*)
app.use(sensitiveLimiter());

// Per-request timeouts (hard cap on handler time)
app.use(timeoutsMiddleware(timeoutCfg));

// Per-upstream circuit breaker (applies to proxy routes)
app.use(circuitBreakerMiddleware(breakerCfg));

// Auth gate: GETs are public except prefixes; all non-GET require auth
app.use(authGate());

// Lightweight root
app.get("/", (_req, res) => res.type("text/plain").send("gateway is up"));

// ── Health / Readiness (pings ACT as representative upstream) ────────────────
const ACT_URL = requireUpstream("ACT_SERVICE_URL");

const readiness: ReadinessFn = async (_req) => {
  try {
    const r = await axios.get(`${ACT_URL}/healthz`, { timeout: 1500 });
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

// ── Routes (one-liners) ──────────────────────────────────────────────────────
app.use("/acts", actRoutes);
app.use("/users", userRoutes);
app.use("/auth", authRoutes);
app.use("/images", imageRoutes);

// ── 404 + Error handlers (Problem+JSON) ──────────────────────────────────────
app.use(notFoundHandler());
app.use(errorHandler());
