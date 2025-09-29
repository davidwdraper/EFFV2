// backend/services/user/src/controllers/userPublicController.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@eff/shared/src/middleware/asyncHandler";
import { NAME_LOOKUP_MAX_IDS } from "../config/public";
import * as repo from "../repo/userRepo";
import { parseIdList, filterValidObjectIds } from "../lib/ids";
import { toFullName } from "../lib/name";

/**
 * GET /users/public/names?ids=ID1,ID2
 * -> { names: { "<id>": "First [Middle] Last", ... } }
 */
export const publicNames: RequestHandler = asyncHandler(async (req, res) => {
  const raw = String(req.query.ids ?? "").trim();
  if (!raw) return res.json({ names: {} });

  const uniq = parseIdList(raw);
  if (uniq.length === 0) return res.json({ names: {} });

  const validIds = filterValidObjectIds(uniq);
  if (validIds.length === 0) return res.json({ names: {} });

  const ids = validIds.slice(0, NAME_LOOKUP_MAX_IDS);

  const users = await repo.findNamesByIds(ids);

  const names: Record<string, string> = {};
  for (const u of users) {
    names[String((u as any)._id)] = toFullName(
      (u as any).firstname,
      (u as any).middlename,
      (u as any).lastname
    );
  }

  return res.json({ names });
});
