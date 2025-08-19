// backend/services/auth/src/app.ts
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import authRoutes from "./routes/authRoutes";
import {
  logger,
  postAudit,
  extractLogContext,
} from "../../shared/utils/logger";
import { createHealthRouter } from "../../shared/health";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// CORS + parsers
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Structured request logging with request-id propagation
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
      return { service: "auth", route: (req as any).route?.path };
    },
    autoLogging: {
      ignore: (req) =>
        ["/health", "/healthz", "/readyz", "/favicon.ico"].includes(req.url),
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

// Entry/exit timing logs
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

// Request-scoped audit buffer (flushed post-response)
declare global {
  namespace Express {
    interface Request {
      audit?: Array<Record<string, any>>;
    }
  }
}
app.use((req, res, next) => {
  req.audit = [];
  res.on("finish", () => {
    if (req.audit?.length) {
      const ctx = extractLogContext(req);
      void postAudit(req.audit.map((e) => ({ ...ctx, ...e })));
      req.log.info(
        { msg: "audit:flush", count: req.audit.length },
        "audit events flushed"
      );
    }
  });
  next();
});

// Health endpoints
app.use(
  createHealthRouter({
    service: "auth",
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// Routes
app.use("/auth", authRoutes);

// Root sanity (kept from your version)
app.get("/", (_req, res) => res.send("Auth service is up"));

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
    res
      .status(Number.isFinite(status) ? status : 500)
      .json({
        error: {
          code: err?.code || "INTERNAL_ERROR",
          message: err?.message || "Unexpected error",
        },
      });
  }
);

export default app;
