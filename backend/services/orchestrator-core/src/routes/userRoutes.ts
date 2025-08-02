// orchestrator-core/src/routes/userRoutes.ts
import express from "express";
import { proxyRequest } from "../utils/proxyHelper";
import { logger } from "@shared/utils/logger";

const router = express.Router();
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || "http://localhost:4001";

logger.debug("orchestrator-core: userRoutes initialized", {
  routes: ["/users", "/users/email/:eMailAddr"],
  targetService: USER_SERVICE_URL,
});

// Called by authService → creates user
router.post("/", (req, res) => {
  logger.debug("orchestrator-core: POST /users → userService", {
    path: req.path,
    bodyKeys: Object.keys(req.body || {}),
  });

  proxyRequest(req, res, `${USER_SERVICE_URL}/users`);
});

// Called by authService → fetch user by email
router.get("/email/:eMailAddr", (req, res) => {
  const { eMailAddr } = req.params;

  logger.debug("orchestrator-core: GET /users/email/:eMailAddr → userService", {
    path: req.path,
    eMailAddr,
  });

  proxyRequest(req, res, `${USER_SERVICE_URL}/users/email/${eMailAddr}`);
});

export default router;
