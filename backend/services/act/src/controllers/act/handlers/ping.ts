// backend/services/act/src/controllers/act/handlers/ping.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, service: "act", ts: new Date().toISOString() });
});
