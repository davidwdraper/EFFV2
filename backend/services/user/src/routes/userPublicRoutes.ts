// src/routes/userPublicRoutes.ts
import express from "express";
import { Types } from "mongoose";
import { UserModel } from "../models/User";

const router = express.Router();

// Allow ops to cap batch size (defaults sane).
const MAX_IDS = Number(process.env.USER_NAME_LOOKUP_MAX_IDS ?? "200");

/**
 * GET /users/public/names?ids=ID1,ID2
 * Returns: { names: { "ID1": "First Last", "ID2": "First Middle Last" } }
 *
 * Notes:
 * - Invalid ObjectIds are ignored.
 * - Duplicates are removed.
 * - Only found IDs are returned (missing IDs omitted).
 */
router.get("/public/names", async (req, res) => {
  try {
    const raw = (req.query.ids ?? "").toString().trim();
    if (!raw) return res.json({ names: {} });

    // Split, trim, dedupe
    const uniq = Array.from(
      new Set(
        raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );

    if (uniq.length === 0) return res.json({ names: {} });

    // Keep only valid ObjectIds
    const validIds = uniq.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) return res.json({ names: {} });

    // Cap to prevent abuse
    const ids = validIds.slice(0, MAX_IDS);

    const users = await UserModel.find(
      { _id: { $in: ids } },
      { _id: 1, firstname: 1, middlename: 1, lastname: 1 }
    ).lean();

    const names: Record<string, string> = {};
    for (const u of users) {
      const fullName = [u.firstname, u.middlename, u.lastname]
        .filter((p) => !!p && String(p).trim().length > 0)
        .join(" ");
      names[String(u._id)] = fullName;
    }

    return res.json({ names });
  } catch (err) {
    console.error("Error in /users/public/names:", err);
    return res.status(500).json({ error: "Failed to fetch user names" });
  }
});

export default router;
