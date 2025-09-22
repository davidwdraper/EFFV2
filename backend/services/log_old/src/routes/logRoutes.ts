// backend/services/log/src/routes/logRoutes.ts
/**
 * NowVibin — Backend
 * Service: log
 * -----------------------------------------------------------------------------
 * WHY:
 * - Follow the shared “api.use(...)" pattern so every worker mounts resources
 *   the same way. The incoming `api` router is already rooted at:
 *       /api/<slug>/v<major>
 *   so this file MUST NOT hardcode version segments.
 * - Mount a JSON body parser on the versioned API router BEFORE resource routes.
 *   WHY: some global middleware chains don’t consume the body; without an
 *   explicit parser here, PUT/POST bodies can sit unread and appear to “hang.”
 * - Keep routes one-liners per SOP. Start minimal and add guardrails back after
 *   the green path is confirmed.
 *
 * Resulting URL shape (no version hardcoded here):
 *   /api/log/v<major>/logs
 */

import { Router, json } from "express";
import * as h from "../handlers/log.handlers";
// import { requireJson } from "../middleware/requireJson";
// import { enforceAllowlist } from "../middleware/allowlist";
// import { rateLimitIngest } from "../middleware/rateLimit";

/**
 * The shared app builder calls this with `api` already mounted at:
 *   /api/<slug>/v<major>
 */
export function mountRoutes(api: Router) {
  // ── Parse JSON on the versioned API router BEFORE we mount any resource routes.
  // WHY:
  // - Guarantees PUT/POST bodies are consumed and available as req.body.
  // - Prevents upstream middlewares from “holding” the stream and causing timeouts.
  api.use(json({ limit: "1mb" }));

  // Resource router under /logs (no version here)
  const r = Router();

  // Lightweight probe (no DB) for quick smoke
  r.get("/ping", h.ping);

  // SOP: Create = PUT; service generates _id; returns acceptance count (202)
  // Start minimal; re-enable guardrails once green:
  // r.put("/", enforceAllowlist, requireJson, rateLimitIngest, h.create);
  r.put("/", h.create);

  // Optional transitional POST support (remove after callers migrate)
  // r.post("/", h.create);

  // Mount resource under the versioned api base:
  // Final path: /api/log/v<major>/logs
  api.use("/logs", r);
}
