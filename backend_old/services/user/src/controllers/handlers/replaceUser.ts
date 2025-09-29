// backend/services/user/src/controllers/handlers/replaceUser.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@eff/shared/src/middleware/asyncHandler";
import { zUserReplace } from "../../contracts/userContracts";
import * as svc from "../../services/user.service";

// PUT /api/user/:id
export const replaceUser: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zUserReplace.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Missing required fields: email, firstname, lastname" });
  }
  const out = await svc.replaceUser(String(req.params.id), parsed.data);
  if ("badId" in out)
    return res.status(400).json({ error: "Invalid id format" });
  if ("notFound" in out)
    return res.status(404).json({ error: "User not found" });
  if ("conflict" in out)
    return res.status(409).json({ error: "User already exists" });

  req.audit?.push({
    type: "replace",
    model: "User",
    id: String(req.params.id),
  });
  return res.status(200).json(out.dto);
});
