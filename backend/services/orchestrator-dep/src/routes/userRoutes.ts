import express from "express";
import { proxyRequest } from "../utils/proxyHelper";
import { createAuthenticateMiddleware } from "../middleware/authenticate";
import { JWT_SECRET } from "./shared/env"; // adjust path if needed

const router = express.Router();
const SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:4001";

// 🛡️ Safe middleware injection
let authenticate: express.RequestHandler;
try {
  authenticate = createAuthenticateMiddleware(JWT_SECRET);
} catch (err) {
  console.error(
    "[userRoutes] Failed to initialize authentication middleware:",
    err
  );
  authenticate = (_req, res, _next) => {
    res.status(500).json({ error: "Authentication system misconfigured" });
  };
}

// ✅ PUT and DELETE use auth
router.put("*", authenticate, (req, res) => {
  proxyRequest(req, res, SERVICE_URL).catch((err) => {
    console.error("[userRoutes] Proxy error (PUT):", err);
    res.status(500).json({ error: "Internal proxy error" });
  });
});

router.delete("*", authenticate, (req, res) => {
  proxyRequest(req, res, SERVICE_URL).catch((err) => {
    console.error("[userRoutes] Proxy error (DELETE):", err);
    res.status(500).json({ error: "Internal proxy error" });
  });
});

// ✅ GET and POST (no auth)
router.get("*", (req, res) => {
  proxyRequest(req, res, SERVICE_URL).catch((err) => {
    console.error("[userRoutes] Proxy error (GET):", err);
    res.status(500).json({ error: "Internal proxy error" });
  });
});

router.post("*", (req, res) => {
  proxyRequest(req, res, SERVICE_URL).catch((err) => {
    console.error("[userRoutes] Proxy error (POST):", err);
    res.status(500).json({ error: "Internal proxy error" });
  });
});

export default router;
