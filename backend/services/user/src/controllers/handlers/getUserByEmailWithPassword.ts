// backend/services/user/src/controllers/handlers/getUserByEmailWithPassword.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@eff/shared/src/middleware/asyncHandler";
import * as svc from "../../services/user.service";

// GET /api/user/private/email/:email
export const getUserByEmailWithPassword: RequestHandler = asyncHandler(
  async (req, res) => {
    const out = await svc.getUserByEmailWithPassword(String(req.params.email));
    if ("notFound" in out)
      return res.status(404).json({ error: "User not found" });
    return res.status(200).json(out.dto);
  }
);
