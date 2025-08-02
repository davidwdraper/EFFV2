// orchestrator/src/routes/authRoutes.ts
import express from "express";
import { proxyRequest } from "../utils/proxyHelper";
import { logger } from "@shared/utils/logger";

const router = express.Router();
const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:4005";

logger.debug("orchestrator: authRoutes initialized", {
  routes: ["/auth/signup", "/auth/login"],
  targetService: AUTH_SERVICE_URL,
});

router.post("/signup", (req, res) => {
  logger.debug("orchestrator: POST /auth/signup → authService", {
    path: req.path,
    bodyKeys: Object.keys(req.body || {}),
  });

  proxyRequest(req, res, `${AUTH_SERVICE_URL}`);
});

router.post("/login", (req, res) => {
  logger.debug("orchestrator: POST /auth/login → authService", {
    path: req.path,
    bodyKeys: Object.keys(req.body || {}),
  });

  proxyRequest(req, res, `${AUTH_SERVICE_URL}`);
});

export default router;
