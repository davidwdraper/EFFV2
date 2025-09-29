// backend/services/user/src/controllers/handlers/getById.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@eff/shared/src/middleware/asyncHandler";
import * as svc from "../../services/user.service";

// GET /api/user/:id
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const out = await svc.getUserById(String(req.params.id));
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  return res.status(200).json(out.dto);
});
