// backend/services/act/src/controllers/act/handlers/getById.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zodBadRequest, zActDto, respond } from "@shared/contracts";
import { notFound } from "@shared/http/errors";
import * as repo from "../../../repo/actRepo";
import { toActDto } from "../../../dto/actDto";
import { zIdParam } from "./schemas";

export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { id } = parsed.data;

  const doc = await repo.findById(id);
  if (!doc) return notFound(res);
  return respond(res, zActDto, toActDto(doc));
});
