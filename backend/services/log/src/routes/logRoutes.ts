// backend/services/log/src/routes/logRoutes.ts
import { Router } from "express";
import * as c from "../controllers/logController";
import { requireInternalToken } from "../middleware/authInternal";
import { rateLimitIngest } from "../middleware/rateLimit";
import { requireJson } from "../middleware/requireJson";
import { enforceAllowlist } from "../middleware/allowlist";

const r = Router();

r.get("/ping", c.ping);

// Ingest: **strict** order → token → allowlist → content-type → rate limit → controller
r.post(
  "/",
  requireInternalToken,
  enforceAllowlist,
  requireJson,
  rateLimitIngest,
  c.create
);

export default r;
