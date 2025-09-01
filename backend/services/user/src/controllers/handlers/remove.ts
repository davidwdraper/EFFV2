// backend/services/user/src/controllers/handlers/remove.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import * as svc from "../../services/userService";

// DELETE /api/user/:id
export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const out = await svc.removeUser(String(req.params.id));
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });

  req.audit?.push({ type: "delete", model: "User", id: String(req.params.id) });
  return res.status(200).json({ success: true });
});
