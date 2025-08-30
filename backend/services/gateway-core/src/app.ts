// backend/services/gateway-core/src/app.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { genericProxy } from "./middleware/genericProxy";

// ──────────────────────────────────────────────────────────────────────────────
// Minimal health endpoints (no shared deps required)
const health = express.Router();
health.get("/live", (_req, res) =>
  res.status(200).json({ ok: true, live: true })
);
health.get("/ready", (_req, res) =>
  res.status(200).json({ ok: true, ready: true })
);

// ──────────────────────────────────────────────────────────────────────────────
// Create app and mount in the correct order:
// 1) health
// 2) /api proxy (BEFORE parsers!)
// 3) parsers
// 4) 404 + error handlers
export const app = express();

// 1) health
app.use("/health", health);

// 2) raw proxy BEFORE any body parsers
app.use("/api", genericProxy());

// 3) parsers (safe after proxy)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// 4a) 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail: "Route not found",
    instance: req.headers["x-request-id"] ?? undefined,
  });
});

// 4b) error handler (Problem+JSON style)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  const title = status === 500 ? "Internal Server Error" : "Bad Request";
  res.status(status).json({
    type: "about:blank",
    title,
    status,
    detail: String(err?.message ?? err),
    instance: req.headers["x-request-id"] ?? undefined,
  });
});
