// backend/services/act/src/app.ts

import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

import actRoutes from "./routes/actRoutes";
import townRoutes from "./routes/townRoutes"; // ← ADDED
import {
  logger,
  postAudit,
  extractLogContext,
} from "../../shared/utils/logger";
import { createHealthRouter } from "../../shared/health";

// ── Env enforcement (no defaults, identical pattern across services)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`Missing required env var: ${name}`);
  return v;
}
const SERVICE_NAME = requireEnv("ACT_SERVICE_NAME");
requireEnv("ACT_MONGO_URI");
requireEnv("ACT_PORT");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

// CORS (internal friendly; tighten if you restrict service-to-service)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Pino HTTP (same shape as gateway)
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
      const userId = (req as any)?.user?.userId || (req as any)?.auth?.userId;
      return {
        service: SERVICE_NAME,
        route: (req as any).route?.path,
        userId,
      };
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
        return { id: (req as any).id, method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

// ── Entry/Exit instrumentation (uniform)
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  req.log.info(
    {
      msg: "handler:start",
      method: req.method,
      url: req.originalUrl,
      params: req.params,
      query: req.query,
    },
    "request entry"
  );
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    req.log.info(
      {
        msg: "handler:finish",
        statusCode: res.statusCode,
        durationMs: Math.round(ms),
      },
      "request exit"
    );
  });
  next();
});

// ── Audit hook (controllers push to req.audit; flush once per request)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      audit?: Array<Record<string, any>>;
    }
  }
}
app.use((req, res, next) => {
  req.audit = [];
  res.on("finish", () => {
    if (req.audit && req.audit.length) {
      const ctx = extractLogContext(req);
      const events = req.audit.map((e) => ({ ...ctx, ...e }));
      void postAudit(events);
      req.log.info(
        { msg: "audit:flush", count: events.length },
        "audit events flushed"
      );
    }
  });
  next();
});

// ── Health (identical callsite to gateway)
app.use(
  createHealthRouter({
    service: SERVICE_NAME,
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// ── Routes
app.use("/acts", actRoutes);
app.use("/towns", townRoutes); // ← ADDED

// ── 404 and error handler (Problem+JSON)
app.use((req, res, _next) => {
  if (
    req.path.startsWith("/acts") ||
    req.path.startsWith("/towns") || // ← ADDED
    req.path.startsWith("/health")
  ) {
    return res
      .status(404)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Route not found",
        instance: (req as any).id,
      });
  }
  return res.status(404).end();
});

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const status = Number(err?.statusCode || err?.status || 500);
    req.log?.error({ msg: "handler:error", err, status }, "request error");
    res
      .status(Number.isFinite(status) ? status : 500)
      .type("application/problem+json")
      .json({
        type: err?.type || "about:blank",
        title: err?.title || "Internal Server Error",
        status: Number.isFinite(status) ? status : 500,
        detail: err?.message || "Unexpected error",
        instance: (req as any).id,
      });
  }
);

export default app;
