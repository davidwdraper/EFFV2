// routes/userProxyRoutes.ts
import express from "express";
import axios from "axios";
import { logger } from "@shared/utils/logger";

const router = express.Router();

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || "http://localhost:4001";

// Create user (signup)
router.post("/", async (req, res) => {
  logger.debug("orchestrator-core: POST /users proxy called", {
    target: `${USER_SERVICE_URL}/users`,
  });

  try {
    const path = `${USER_SERVICE_URL}/users`;
    logger.debug(`calling user service with: ${path}`);

    const response = await axios.post(path, req.body, {
      headers: { ...req.headers }, // ✅ forward all headers, including Authorization
    });

    res.status(response.status).json(response.data);
  } catch (err: any) {
    logger.error("orchestrator-core: Failed to proxy POST /users", {
      error: err?.response?.data || err.message,
    });
    res.status(err?.response?.status || 500).json({
      error: "Failed to create user",
      detail: err?.response?.data || err.message,
    });
  }
});

// Get user by email (for login)
router.get("/private/email/:eMailAddr", async (req, res) => {
  const eMailAddr = req.params.eMailAddr;

  const targetUrl = `${USER_SERVICE_URL}/users/private/email/${encodeURIComponent(
    eMailAddr
  )}`;

  logger.debug("orchestrator-core: GET /users/private/email proxy called", {
    targetUrl,
  });

  try {
    const response = await axios.get(targetUrl, {
      headers: { ...req.headers }, // ✅ forward all headers
    });

    logger.debug("📬 Response from userService", { data: response.data });
    res.status(response.status).json(response.data);
  } catch (err: any) {
    logger.error("orchestrator-core: Failed to proxy GET /users/email", {
      error: err?.response?.data || err.message,
    });
    res.status(err?.response?.status || 500).json({
      error: "Failed to fetch user by email",
      detail: err?.response?.data || err.message,
    });
  }
});

export default router;
