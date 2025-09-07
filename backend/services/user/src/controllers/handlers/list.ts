// backend/services/user/src/controllers/handlers/list.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import * as svc from "../../services/user.service";

// GET /api/user
export const list: RequestHandler = asyncHandler(async (_req, res) => {
  const dtos = await svc.listUsers();
  return res.status(200).json(dtos);
});
