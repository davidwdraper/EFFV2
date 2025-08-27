// backend/services/act/src/controllers/act/handlers/list.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zodBadRequest, zActListDto, respond } from "@shared/contracts";
import { makeList } from "@shared/http/pagination";
import { escapeRe } from "../../../lib/search";
import { toActDto } from "../../../dto/actDto";
import * as repo from "../../../repo/actRepo";
import { zListQuery } from "./schemas";

export const list: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zListQuery.safeParse(req.query);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { name, limit, offset } = parsed.data;

  const filter: Record<string, any> = {};
  if (name) filter.name = { $regex: new RegExp(escapeRe(name), "i") };

  const [rows, total] = await Promise.all([
    repo.list(filter, limit, offset),
    repo.count(filter),
  ]);

  return respond(
    res,
    zActListDto,
    makeList(rows.map(toActDto), limit, offset, total)
  );
});
