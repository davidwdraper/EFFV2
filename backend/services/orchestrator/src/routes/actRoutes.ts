// orchestrator/src/routes/actRoutes.ts
import express, { Request, Response } from "express";
import { logger } from "@shared/utils/logger";
import { proxyRequest } from "../utils/proxyHelper";

const router = express.Router();

// Base URL for the Act microservice
const ACT_SERVICE_URL = (
  process.env.ACT_SERVICE_URL?.trim() || "http://localhost:4002"
).replace(/\/+$/, "");

// Minimal forwarder that matches your proxyRequest(string) signature
function forward(req: Request, res: Response) {
  // NOTE: Your helper likely builds the target as: targetBase + req.originalUrl
  // so we pass just the base here.
  return proxyRequest(req, res, ACT_SERVICE_URL);
}

/**
 * Public GETs (mostly for cleaner logs; auth handled globally by authGate)
 */
router.get("/hometowns", (req, res) => {
  logger.debug("[Orch/Acts] GET /hometowns", {
    originalUrl: req.originalUrl,
    targetBase: ACT_SERVICE_URL,
  });
  return forward(req, res);
});

router.get("/hometowns/near", (req, res) => {
  logger.debug("[Orch/Acts] GET /hometowns/near", {
    originalUrl: req.originalUrl,
    targetBase: ACT_SERVICE_URL,
  });
  return forward(req, res);
});

/**
 * Everything else under /acts -> Act service
 * Includes: /, /:id, /townload, etc.
 */
router.all("*", (req, res) => {
  logger.debug("[Orch/Acts] proxy all", {
    method: req.method,
    originalUrl: req.originalUrl,
    targetBase: ACT_SERVICE_URL,
  });
  return forward(req, res);
});

export default router;
