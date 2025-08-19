// orchestrator/src/routes/actRoutes.ts
import express, { Request, Response } from "express";
import { logger } from "@shared/utils/logger";
import { proxyRequest } from "../utils/proxyHelper";

const router = express.Router();

const ACT_SERVICE_URL = (
  process.env.ACT_SERVICE_URL?.trim() || "http://localhost:4002"
).replace(/\/+$/, "");
const ACT_ACTS_BASE = `${ACT_SERVICE_URL}/acts`; // ✅ include mount

function forward(req: Request, res: Response) {
  const orig = req.originalUrl;
  (req as any).originalUrl = req.url.startsWith("/") ? req.url : `/${req.url}`;
  const result = proxyRequest(req, res, ACT_ACTS_BASE); // ✅ use acts base
  (req as any).originalUrl = orig;
  return result;
}

router.get("/search", (req, res) => {
  logger.debug("[Orch/Acts] GET /acts/search → Act:/acts/search", {
    baseUrl: req.baseUrl,
    url: req.url,
    originalUrl: req.originalUrl,
    targetBase: ACT_ACTS_BASE,
  });
  return forward(req, res);
});

// (optional legacy passthroughs)
router.get("/hometowns", forward);
router.get("/hometowns/near", forward);

// Catch-all
router.all("*", (req, res) => {
  logger.debug("[Orch/Acts] proxy all → Act:/acts/*", {
    method: req.method,
    baseUrl: req.baseUrl,
    url: req.url,
    originalUrl: req.originalUrl,
    targetBase: ACT_ACTS_BASE,
  });
  return forward(req, res);
});

export default router;
