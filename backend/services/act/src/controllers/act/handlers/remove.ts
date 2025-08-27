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

  // Perform the deletion and decide based on the outcome.
  const deleted = await repo.deleteById(id);

  if (!deleted) return notFound(res);

  res.status(204).send();
});
