// backend/services/user/src/controllers/handlers/create.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zUserCreate } from "../../contracts/userContracts";
import * as svc from "../../services/userService";

// POST /api/user
export const create: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zUserCreate.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Missing or invalid fields" });
  }
  const out = await svc.createUser(parsed.data);
  if ("conflict" in out)
    return res.status(409).json({ error: "User already exists" });

  req.audit?.push({
    type: "create",
    model: "User",
    id: String((out as any).doc?._id),
    email: (out as any).doc?.email,
  });

  return res.status(201).json(out.dto);
});
