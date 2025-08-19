// backend/services/gateway/src/app.ts
import express from "express";
import cors from "cors";
import { createHealthRouter } from "../../shared/health";
import userRoutes from "./routes/userRoutes";

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

app.use(
  createHealthRouter({
    service: "gateway",
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// one-liner mount per group
app.use("/users", userRoutes);

app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
