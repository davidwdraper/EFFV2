// backend/services/user/src/controllers/userPublicController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Types } from "mongoose";
import UserModel from "../models/User";

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Optional cap from env; if unset or invalid, fall back to sane internal cap.
// (Not a secret; not required — so we don't assert in bootstrap.)
const INTERNAL_DEFAULT_MAX = 200;
const maxIdsCap = (() => {
  const raw = process.env.USER_NAME_LOOKUP_MAX_IDS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : INTERNAL_DEFAULT_MAX;
})();

/**
 * GET /users/public/names?ids=ID1,ID2
 * -> { names: { "<id>": "First [Middle] Last", ... } }
 */
export const publicNames: RequestHandler = asyncHandler(async (req, res) => {
  const raw = String(req.query.ids ?? "").trim();
  if (!raw) return res.json({ names: {} });

  // split, trim, dedupe
  const uniq = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  if (uniq.length === 0) return res.json({ names: {} });

  // keep only valid ObjectIds
  const validIds = uniq.filter((id) => Types.ObjectId.isValid(id));
  if (validIds.length === 0) return res.json({ names: {} });

  const ids = validIds.slice(0, maxIdsCap);

  const users = await UserModel.find(
    { _id: { $in: ids } },
    { _id: 1, firstname: 1, middlename: 1, lastname: 1 }
  ).lean();

  const names: Record<string, string> = {};
  for (const u of users) {
    const full = [u.firstname, u.middlename, u.lastname]
      .filter((p) => !!p && String(p).trim().length > 0)
      .join(" ");
    names[String(u._id)] = full;
  }

  return res.json({ names });
});
