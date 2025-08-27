// backend/services/act/src/controllers/act/handlers/remove.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zodBadRequest } from "@shared/contracts";
import { notFound } from "@shared/http/errors";
import * as repo from "../../../repo/actRepo";
import { zIdParam } from "./schemas";

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { id } = parsed.data;

  // Deterministic: check existence first
  const existed = await repo.findById(id);
  if (!existed) return notFound(res);

  // Best-effort delete; we don't hinge status on the return shape
  await repo.deleteById(id);

  res.status(204).send();
});
