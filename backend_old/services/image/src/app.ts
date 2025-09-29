// backend/services/image/src/app.ts
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import imageRoutes from "./routes/imageRoutes";
import { serviceName } from "./config";
import {
  logger,
  postAudit,
  extractLogContext,
} from "../../shared/utils/logger";
import { createHealthRouter } from "../../shared/src/health";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// CORS
app.use(cors({ origin: true, credentials: true }));
// Expose custom headers so frontend can read image metadata from /data responses
app.use((_req, res, next) => {
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "ETag",
      "Last-Modified",
      "Content-Length",
      "Content-Type",
      "X-Image-Id",
      "X-Image-Filename",
      "X-Image-Checksum",
      "X-Image-Bytes",
      "X-Image-Width",
      "X-Image-Height",
      "X-Image-State",
      "X-Image-Moderation",
      "X-Image-CreatedBy",
      "X-Image-Notes",
      "X-Image-CreationDate",
    ].join(", ")
  );
  next();
});

// Parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Structured logging with request-id
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
      return { service: serviceName, route: (req as any).route?.path };
    },
    // Ignore health endpoints and favicon regardless of querystring
    autoLogging: {
      ignore: (req) => {
        const u = req.url.split("?")[0];
        return (
          u === "/health" ||
          u === "/healthz" ||
          u === "/readyz" ||
          u === "/favicon.ico"
        );
      },
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
    { msg: "handler:start", method: req.method, url: req.originalUrl },
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

// Audit buffer
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
        "audit flushed"
      );
    }
  });
  next();
});

// Health endpoints (merged; consistent with shared health router)
app.use(
  createHealthRouter({
    service: serviceName,
    // If you add DB readiness later, call it here and bubble status
    readiness: async () => ({ upstreams: { ok: true } }),
  })
);

// Routes — mount under /images (routes are relative and one-liners)
app.use("/images", imageRoutes);

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
    req.log?.error({ msg: "handler:error", err, status }, "handler error");
    res.status(Number.isFinite(status) ? status : 500).json({
      error: {
        code: err?.code || "INTERNAL_ERROR",
        message: err?.message || "Unexpected error",
      },
    });
  }
);

export default app;
