// backend/services/gateway/src/app.ts
import express from "express";
import cors from "cors";

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

import { httpsOnly } from "./middleware/httpsOnly";
import { loggingMiddleware } from "./middleware/logging";
import { sensitiveLimiter } from "./middleware/sensitiveLimiter";
import { buildGatewayHealthRouter } from "./routes/health.router";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// HTTPS (prod only)
app.use(httpsOnly());

// CORS + body caps
app.use(
  cors({
    origin: "*", // tighten in prod
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

// Request ID → logging → envelope
app.use(requestIdMiddleware());
app.use(loggingMiddleware());
app.use(problemJsonMiddleware());

// Guards
app.use(rateLimitMiddleware(rateLimitCfg));
app.use(sensitiveLimiter());
app.use(timeoutsMiddleware(timeoutCfg));
app.use(circuitBreakerMiddleware(breakerCfg));
app.use(authGate());

// Root + Health
app.get("/", (_req, res) => res.type("text/plain").send("gateway is up"));
app.use(buildGatewayHealthRouter());

// No public proxy plane in the external gateway (SOP)
app.use(notFoundHandler());
app.use(errorHandler());

export default app;
