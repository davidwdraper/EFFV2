// backend/services/user/src/controllers/handlers/patchUser.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@eff/shared/src/middleware/asyncHandler";
import { zUserPatch } from "../../contracts/userContracts";
import * as svc from "../../services/user.service";

// PATCH /api/user/:id
export const patchUser: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zUserPatch.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid patch" });

  const out = await svc.patchUser(String(req.params.id), parsed.data);
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  if ("conflict" in out)
    return res.status(409).json({ error: "User already exists" });

  req.audit?.push({
    type: "patch",
    model: "User",
    id: String(req.params.id),
    fields: Object.keys(parsed.data ?? {}),
  });
  return res.status(200).json(out.dto);
});
