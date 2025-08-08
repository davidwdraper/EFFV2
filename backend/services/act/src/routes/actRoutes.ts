// src/routes/actRoutes.ts
import express, { Request, Response } from "express";
import { Types } from "mongoose";
import Act from "../models/Act";
import Town from "../models/Town";
import {
  enrichManyWithUserNames,
  enrichWithUserNames,
} from "@shared/utils/userNameLookup"; // ✅ enrichment helpers

const router = express.Router();

// ---- config ----
const DEFAULT_RADIUS_MILES = Number(process.env.ACT_RADIUS_SEARCH ?? "50");
const ENRICH_USER_NAMES = process.env.ENRICH_USER_NAMES === "true"; // ✅ feature flag

// Keep list/search payloads lean & consistent
const LIST_PROJECTION = {
  _id: 0,
  id: "$_id",
  name: 1,
  eMailAddr: 1,
  homeTown: 1,
  homeTownId: 1,
  imageIds: 1,
  userCreateId: 1,
  userOwnerId: 1,
} as const;

// ---- helpers ----
const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const milesToMeters = (miles: number) => miles * 1609.34;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function resolveTownFields(input: {
  homeTown?: string;
  townId?: string;
}) {
  let townDoc: any | null = null;

  if (input.townId && Types.ObjectId.isValid(input.townId)) {
    townDoc = await Town.findById(input.townId).lean();
  } else if (input.homeTown) {
    // Expect "City, ST"
    const parts = input.homeTown.split(",").map((s) => s.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        'homeTown must be formatted as "City, ST" (e.g., "Austin, TX").'
      );
    }
    const [city, state] = parts;
    townDoc = await Town.findOne({ name: city, state }).lean();
  }

  if (!townDoc) throw new Error("Hometown not found in Town collection");

  return {
    homeTown: `${townDoc.name}, ${townDoc.state}`,
    homeTownId: townDoc._id,
    homeTownLoc: {
      type: "Point",
      coordinates: [townDoc.lng, townDoc.lat] as [number, number], // [lng, lat]
    },
  };
}

/**
 * ---- SEARCH: GET /acts/search ----
 * Query:
 *   lat (required): number
 *   lng (required): number
 *   q   (optional): string (prefix on name, case-insensitive)
 *   limit (optional): number (default 20, max 50)
 *   miles (optional): number (override ACT_RADIUS_SEARCH for this call)
 */
router.get("/search", async (req: Request, res: Response) => {
  try {
    const lat = toNum(req.query.lat);
    const lng = toNum(req.query.lng);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limitRaw = toNum(req.query.limit);
    const milesRaw = toNum(req.query.miles);

    if (lat === null || lng === null) {
      return res
        .status(400)
        .json({ error: "lat and lng are required numeric query parameters" });
    }

    const limit = Math.min(Math.max(limitRaw ?? 20, 1), 50);
    const radiusMiles = milesRaw ?? DEFAULT_RADIUS_MILES;
    const maxDistance = milesToMeters(radiusMiles);

    const pipeline: any[] = [
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distanceMeters",
          maxDistance,
          spherical: true,
          key: "homeTownLoc",
        },
      },
      ...(q
        ? [
            {
              $match: { name: { $regex: `^${escapeRegex(q)}`, $options: "i" } },
            },
          ]
        : []),
      {
        $project: {
          ...LIST_PROJECTION,
          distanceMeters: 1,
        },
      },
      { $limit: limit },
    ];

    const results = await Act.aggregate(pipeline).exec();

    // Ensure owner defaults to creator (until claim feature exists)
    const items = results.map((r: any) => ({
      ...r,
      userOwnerId: r.userOwnerId || r.userCreateId,
    }));

    const data = ENRICH_USER_NAMES
      ? await enrichManyWithUserNames(items)
      : items;

    return res.status(200).json({
      radiusMiles,
      count: data.length,
      data,
    });
  } catch (err: any) {
    console.error("[acts/search] error:", err);
    return res.status(500).json({
      error: "Failed to search acts",
      detail: err?.message ?? String(err),
    });
  }
});

/**
 * ---- LIST: GET /acts ----
 * Optional:
 *   q        (prefix on name)
 *   homeTown (exact "City, ST")
 *   limit    (<=100)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const homeTown =
      typeof req.query.homeTown === "string" ? req.query.homeTown.trim() : "";
    const limit = Math.min(Math.max(toNum(req.query.limit) ?? 50, 1), 100);

    const filter: any = {};
    if (q) filter.name = { $regex: `^${escapeRegex(q)}`, $options: "i" };
    if (homeTown) filter.homeTown = homeTown;

    // Mirror the projection shape from /search to keep DTOs consistent
    const itemsRaw = await Act.find(filter)
      .limit(limit)
      .select({
        name: 1,
        eMailAddr: 1,
        homeTown: 1,
        homeTownId: 1,
        imageIds: 1,
        userCreateId: 1,
        userOwnerId: 1,
      })
      .lean();

    // Map _id → id, default owner
    const items = itemsRaw.map((r: any) => ({
      id: r._id?.toString?.() ?? r._id,
      name: r.name,
      eMailAddr: r.eMailAddr,
      homeTown: r.homeTown,
      homeTownId: r.homeTownId,
      imageIds: r.imageIds,
      userCreateId: r.userCreateId,
      userOwnerId: r.userOwnerId || r.userCreateId,
    }));

    const data = ENRICH_USER_NAMES
      ? await enrichManyWithUserNames(items)
      : items;

    return res.status(200).json({ count: data.length, data });
  } catch (err: any) {
    console.error("[acts/list] error:", err);
    return res.status(500).json({
      error: "Failed to fetch acts",
      detail: err?.message ?? String(err),
    });
  }
});

/** ---- GET ONE: GET /acts/:id ---- */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });

    const actRaw = await Act.findById(id).lean();
    if (!actRaw) return res.status(404).json({ error: "Act not found" });

    const act = {
      ...actRaw,
      userOwnerId: (actRaw as any).userOwnerId || (actRaw as any).userCreateId,
    };

    const payload = ENRICH_USER_NAMES ? await enrichWithUserNames(act) : act;

    return res.status(200).json({ act: payload });
  } catch (err: any) {
    console.error("[acts/get] error:", err);
    return res.status(500).json({
      error: "Failed to fetch act",
      detail: err?.message ?? String(err),
    });
  }
});

/**
 * ---- CREATE: POST /acts ----
 * Accepts homeTown ("City, ST") OR townId; resolves & denormalizes geo.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const base = req.body ?? {};

    // Ensure date fields exist if your client isn't sending them
    base.dateCreated = base.dateCreated ?? new Date().toISOString();
    base.dateLastUpdated = new Date().toISOString();

    const town = await resolveTownFields({
      homeTown: base.homeTown,
      townId: base.townId,
    });
    const created = await Act.create({ ...base, ...town });

    return res.status(201).json({ message: "Act created", act: created });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ error: "Duplicate Act (name + hometown must be unique)" });
    }
    console.error("[acts/create] error:", err);
    return res
      .status(400)
      .json({ error: err?.message ?? "Failed to create Act" });
  }
});

/**
 * ---- UPDATE: PUT /acts/:id ----
 * If homeTown/townId changes, re-resolve town and update geo fields.
 * Always refresh dateLastUpdated.
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });

    const patch = { ...(req.body ?? {}) };
    patch.dateLastUpdated = new Date().toISOString();

    if (patch.homeTown || patch.townId) {
      const townPatch = await resolveTownFields({
        homeTown: patch.homeTown,
        townId: patch.townId,
      });
      Object.assign(patch, townPatch);
    }

    const updated = await Act.findByIdAndUpdate(id, patch, {
      new: true,
    }).lean();
    if (!updated) return res.status(404).json({ error: "Act not found" });

    return res.status(200).json({ message: "Act updated", act: updated });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ error: "Duplicate Act (name + hometown must be unique)" });
    }
    console.error("[acts/update] error:", err);
    return res
      .status(400)
      .json({ error: err?.message ?? "Failed to update Act" });
  }
});

/** ---- DELETE: DELETE /acts/:id ---- */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id))
      return res.status(400).json({ error: "Invalid id" });

    const deleted = await Act.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ error: "Act not found" });

    return res.status(200).json({ message: "Act deleted" });
  } catch (err: any) {
    console.error("[acts/delete] error:", err);
    return res.status(500).json({
      error: "Failed to delete Act",
      detail: err?.message ?? String(err),
    });
  }
});

export default router;
