// orchestrator/src/routes/townRoutes.ts
import express, { Request, Response } from "express";
import { logger } from "@shared/utils/logger";
import { proxyRequest } from "../utils/proxyHelper";

const router = express.Router();

const ACT_SERVICE_URL = (
  process.env.ACT_SERVICE_URL?.trim() || "http://localhost:4002"
).replace(/\/+$/, "");
const ACT_TOWNS_BASE = `${ACT_SERVICE_URL}/towns`; // ✅ include mount

function forward(req: Request, res: Response) {
  // Ensure proxied path is just the subpath under /towns (e.g., "/typeahead?...")
  const orig = req.originalUrl;
  (req as any).originalUrl = req.url.startsWith("/") ? req.url : `/${req.url}`;
  const result = proxyRequest(req, res, ACT_TOWNS_BASE); // ✅ use towns base
  (req as any).originalUrl = orig;
  return result;
}

router.get("/typeahead", (req, res) => {
  logger.debug("[Orch/Towns] GET /towns/typeahead → Act:/towns/typeahead", {
    baseUrl: req.baseUrl,
    url: req.url,
    originalUrl: req.originalUrl,
    targetBase: ACT_TOWNS_BASE,
  });
  return forward(req, res);
});

router.all("*", (req, res) => {
  logger.debug("[Orch/Towns] proxy all → Act:/towns/*", {
    method: req.method,
    baseUrl: req.baseUrl,
    url: req.url,
    originalUrl: req.originalUrl,
    targetBase: ACT_TOWNS_BASE,
  });
  return forward(req, res);
});

export default router;
