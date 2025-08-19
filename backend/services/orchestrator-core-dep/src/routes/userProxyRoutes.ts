// routes/userProxyRoutes.ts
import express from "express";
import axios, { AxiosError } from "axios";
import { logger } from "@shared/utils/logger";

const router = express.Router();

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || "http://localhost:4001";

function passThroughError(
  res: express.Response,
  err: unknown,
  fallbackMessage: string
) {
  const ax = err as AxiosError;

  // Downstream responded (e.g., 400/401/409/etc) — pass it through untouched
  if (ax && ax.response) {
    const { status, headers, data } = ax.response;
    // Avoid passing hop-by-hop headers
    const {
      connection,
      "transfer-encoding": te,
      "content-length": cl,
      ...safeHeaders
    } = (headers as Record<string, string>) || {};
    return res.status(status).set(safeHeaders).send(data);
  }

  // No downstream response — network/timeout/DNS/etc
  const code = (ax && ax.code) || "";
  const timeout =
    code === "ECONNABORTED" ||
    (typeof (ax as any)?.message === "string" &&
      (ax as any).message.toLowerCase().includes("timeout"));
  const connErr =
    code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH";

  const status = timeout ? 504 : connErr ? 502 : 500;
  return res.status(status).json({
    error: fallbackMessage,
    detail: (ax && ax.message) || "Upstream error",
    code,
  });
}

// Create user (signup) — pass tokens if present, but don't require them
router.post("/", async (req, res) => {
  const path = `${USER_SERVICE_URL}/users`;
  logger.debug("orchestrator-core: POST /users proxy → user-service", { path });

  try {
    const response = await axios.post(path, req.body, {
      headers: { ...req.headers }, // forward all headers (Authorization, etc.)
      validateStatus: () => true, // let us control error handling
    });

    // If user-service explicitly returned a status, forward it verbatim
    return res
      .status(response.status)
      .set(response.headers)
      .send(response.data);
  } catch (err) {
    logger.error("orchestrator-core: POST /users proxy error", {
      error: (err as any)?.response?.data || (err as any)?.message,
    });
    return passThroughError(res, err, "Failed to create user");
  }
});

// Get user by email (for login)
router.get("/private/email/:eMailAddr", async (req, res) => {
  const eMailAddr = req.params.eMailAddr;
  const targetUrl = `${USER_SERVICE_URL}/users/private/email/${encodeURIComponent(
    eMailAddr
  )}`;

  logger.debug(
    "orchestrator-core: GET /users/private/email proxy → user-service",
    { targetUrl }
  );

  try {
    const response = await axios.get(targetUrl, {
      headers: { ...req.headers },
      validateStatus: () => true,
    });

    return res
      .status(response.status)
      .set(response.headers)
      .send(response.data);
  } catch (err) {
    logger.error("orchestrator-core: GET /users/private/email proxy error", {
      error: (err as any)?.response?.data || (err as any)?.message,
    });
    return passThroughError(res, err, "Failed to fetch user by email");
  }
});

export default router;
