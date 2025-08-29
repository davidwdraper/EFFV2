// backend/services/gateway-core/src/app.ts
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

import { verifyInternalJwt } from "./middleware/verifyInternalJwt";
// import { createHealthRouter } from "../../shared/health"; // ← unused; remove
import { logger } from "../../shared/utils/logger";
import { serviceName, rateLimitCfg, timeoutCfg, breakerCfg } from "./config";

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
import { genericProxy } from "./middleware/genericProxy";
import { buildGatewayCoreHealthRouter } from "./routes/health.router";

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

// CORS + body parsing
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
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Request ID FIRST so all logs include it (including auth failures)
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
      ignore: (req) => {
        const u = req.url || "";
        // Ignore any health-ish paths, regardless of suffix or query
        return (
          u === "/favicon.ico" ||
          u.startsWith("/health") ||
          u.startsWith("/healthz") ||
          u.startsWith("/readyz")
        );
      },
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

// Rate limits, timeouts, breaker, extra guards
app.use(rateLimitMiddleware(rateLimitCfg));
app.use(sensitiveLimiter());
app.use(timeoutsMiddleware(timeoutCfg));
app.use(circuitBreakerMiddleware(breakerCfg));

// Health (no auth for health) — keep this BEFORE auth
app.use(buildGatewayCoreHealthRouter());

// Simple root ping
app.get("/", (_req, res) => res.type("text/plain").send("gateway-core is up"));

// Internal S2S auth AFTER logging so 401s are visible with reqId
app.use((req, _res, next) => {
  logger.debug(
    { reqId: (req as any).id },
    "[auth] placing verifyInternalJwt + authGate"
  );
  next();
});
app.use(verifyInternalJwt);
app.use(authGate());

// Proxy plane (/api/<service>/<rest>)
app.use("/api", genericProxy());

// 404 + error handlers
app.use(notFoundHandler());
app.use(errorHandler());

export default app;
