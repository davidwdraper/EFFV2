// backend/services/gateway/src/app.ts

import express from "express";
import cors from "cors";
import axios from "axios";
import { createHealthRouter, ReadinessFn } from "../../shared/health";

import actRoutes from "./routes/actRoutes";
import userRoutes from "./routes/userRoutes";
import authRoutes from "./routes/authRoutes";

import { serviceName, requireUpstream } from "./config";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "x-request-id"],
  })
);

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.send("gateway is up"));

// Upstream (throws if missing; consistent with requireUpstream contract)
const ACT_URL = requireUpstream("ACT_SERVICE_URL");

// define readiness fn with proper signature
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
    service: serviceName, // comes from config.ts (named export)
    readiness,
  })
);

// one-liner mount per group
app.use("/acts", actRoutes);
app.use("/users", userRoutes);
app.use("/auth", authRoutes);

app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const status = Number(err?.status || err?.statusCode || 500);
    res.status(Number.isFinite(status) ? status : 500).json({
      error: {
        code: err?.code || "INTERNAL_ERROR",
        message: err?.message || "Unexpected error",
      },
    });
  }
);
