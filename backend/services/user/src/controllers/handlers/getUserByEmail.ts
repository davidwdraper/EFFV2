// backend/services/user/src/controllers/handlers/getUserByEmail.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import * as svc from "../../services/userService";

// GET /api/user/email/:email
export const getUserByEmail: RequestHandler = asyncHandler(async (req, res) => {
  const out = await svc.getUserByEmail(String(req.params.email));
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  return res.status(200).json(out.dto);
});
