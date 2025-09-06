// backend/services/log/src/app.ts
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import "@shared/types/express"; // req.user typing

import { connectDB } from "./db";
import logRoutes from "./routes/logRoutes";
import { logger } from "../../shared/utils/logger";
import { createHealthRouter } from "../../shared/health";
import { config } from "./config";
import { SERVICE_NAME } from "./bootstrap";

const app = express();

// Hardening & basics
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const hdr =
        req.headers["x-request-id"] ||
        req.headers["x-correlation-id"] ||
        req.headers["x-amzn-trace-id"];
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
      res.setHeader("x-request-id", id);
      return String(id);
    },
    customLogLevel(_req, res, err) {
      if (err) return "error";
      const s = res.statusCode;
      if (s >= 500) return "error";
      if (s >= 400) return "warn";
      return "info";
    },
    customProps(req) {
      return { service: SERVICE_NAME, route: (req as any).route?.path };
    },
    autoLogging: {
      ignore: (req) =>
        req.url === "/health" ||
        req.url === "/healthz" ||
        req.url === "/readyz" ||
        req.url === "/health/deep" ||
        req.url === "/favicon.ico",
    },
    serializers: {
      req(req) {
        return { id: (req as any).id, method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

// Connect DB before routes (fail fast if it throws)
void connectDB();

// Health endpoints
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// Deep health: confirms DB connectivity for logger deepPing()
app.get("/health/deep", (_req, res) => {
  const ready = mongoose.connection.readyState === 1; // connected
  res.json({
    ok: ready,
    service: SERVICE_NAME,
    db: {
      connected: ready,
      name: (mongoose.connection as any).name || undefined,
      host: (mongoose.connection as any).host || undefined,
    },
  });
});

// Routes — one-liners
app.use("/logs", logRoutes);
app.use("/log", logRoutes); // alias if you’re still calling it

// 404 + error handler
app.use((_req, res) =>
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } })
);

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const status = Number(err?.status || err?.statusCode || 500);
    req.log?.error({ msg: "handler:error", err, status }, "request error");
    res.status(Number.isFinite(status) ? status : 500).json({
      error: {
        code: err?.code || "INTERNAL_ERROR",
        message: err?.message || "Unexpected error",
      },
    });
  }
);

export default app;
