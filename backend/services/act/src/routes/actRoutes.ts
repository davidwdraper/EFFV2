import express from "express";
import axios from "axios";
import csvParser from "csv-parser";
import { Readable } from "stream";
import { logger } from "@shared/utils/logger";
import { authenticate } from "@shared/middleware/authenticate";
import { dateNowIso } from "@shared/utils/dateUtils";
import Act from "../models/Act";
import Town from "../models/Town";
import { IAct } from "@shared/interfaces/Act/IAct";
import { INewAct } from "@shared/interfaces/Act/INewAct";
import { IActUpdate } from "@shared/interfaces/Act/IActUpdate";

const router = express.Router();

/**
 * POST /acts — Create Act (auth required)
 */
router.post("/", authenticate, async (req, res) => {
  try {
    const { actType, name, eMailAddr, homeTown } = req.body as INewAct;

    const userCreateId = req.user?._id;
    if (!userCreateId) return res.status(401).send({ error: "Unauthorized" });

    if (!Array.isArray(actType) || actType.length === 0)
      return res
        .status(400)
        .send({ error: "actType must be a non-empty array" });
    if (!name) return res.status(400).send({ error: "name is required" });

    const now = dateNowIso();

    const act = new Act({
      dateCreated: now,
      dateLastUpdated: now,
      actStatus: 0,
      actType,
      name,
      eMailAddr,
      homeTown,
      userCreateId,
      userOwnerId: userCreateId,
      imageIds: [],
    });

    await act.save();
    res.status(201).send(act.toObject());
  } catch (err) {
    if (
      err instanceof Error &&
      typeof (err as any).code === "number" &&
      (err as any).code === 11000
    ) {
      return res.status(409).send({
        error: "An Act with that name already exists in this homeTown.",
      });
    }
    logger.error("[ActService] POST /acts failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send({ error: "Failed to create Act" });
  }
});

/**
 * GET /acts — Public
 */
router.get("/", async (_req, res) => {
  try {
    const acts: IAct[] = await Act.find().lean();
    res.send(acts);
  } catch (err) {
    logger.error("[ActService] GET /acts failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send({ error: "Failed to fetch Acts" });
  }
});

/**
 * GET /acts/townload — Admin-only: Load towns from CSV to Mongo (with GeoJSON)
 */
router.get("/townload", authenticate, async (req, res) => {
  try {
    if (!req.user || req.user.userType < 3) {
      return res.status(403).send({ error: "Admin access only" });
    }

    const csvUrl = "https://simplemaps.com/static/data/us-cities/uscities.csv";
    const response = await axios.get(csvUrl, { responseType: "stream" });

    const towns: {
      name: string;
      state: string;
      lat: number;
      lng: number;
      loc: { type: "Point"; coordinates: [number, number] };
    }[] = [];

    const parser = response.data.pipe(csvParser());

    for await (const row of parser) {
      if (!row.city || !row.state_id || !row.lat || !row.lng) continue;
      const lat = parseFloat(row.lat);
      const lng = parseFloat(row.lng);
      towns.push({
        name: row.city,
        state: row.state_id,
        lat,
        lng,
        loc: { type: "Point", coordinates: [lng, lat] }, // [lng, lat]
      });
    }

    await Town.deleteMany({});
    await Town.insertMany(towns);

    res.send({ success: true, count: towns.length });
  } catch (err) {
    logger.error("[ActService] GET /acts/townload failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send({ error: "Failed to download towns" });
  }
});

/**
 * GET /acts/hometowns — Public: DB-powered suggestions
 * Query: q (>=3 chars), state=2-letter optional, limit (default 10, max 25)
 */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/hometowns", async (req, res) => {
  try {
    const rawQ = (req.query.q as string | undefined)?.trim() ?? "";
    const state = (req.query.state as string | undefined)?.trim().toUpperCase();
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 25);

    if (rawQ.length < 3) return res.json([]);

    const starts = new RegExp("^" + escapeRegex(rawQ), "i");
    const contains = new RegExp(escapeRegex(rawQ), "i");

    const filter: any = { $or: [{ name: starts }, { name: contains }] };
    if (state && /^[A-Z]{2}$/.test(state)) filter.state = state;

    const towns = await Town.find(filter, {
      _id: 0,
      name: 1,
      state: 1,
      lat: 1,
      lng: 1,
    })
      .limit(limit)
      .sort({ name: 1 })
      .lean();

    const results = towns.map((t) => ({
      label: `${t.name}, ${t.state}`,
      name: t.name,
      state: t.state,
      lat: t.lat,
      lng: t.lng,
    }));

    res.json(results);
  } catch (err) {
    logger.error("[ActService] GET /acts/hometowns failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send({ error: "Failed to fetch hometowns" });
  }
});

/**
 * GET /acts/hometowns/near — Public radius search
 * Query: lat, lng (required); radiusMi (optional, default ACT_RADIUS_SEARCH or 50); limit (default 50, max 200)
 */
const toNum = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const MI_TO_M = 1609.344;

router.get("/hometowns/near", async (req, res) => {
  try {
    logger.debug("Entering hometowns/near");
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res
        .status(400)
        .send({ error: "lat and lng are required numbers" });
    }

    const defaultRadius = toNum(process.env.ACT_RADIUS_SEARCH, 50);
    const radiusMi = toNum(req.query.radiusMi, defaultRadius);
    const limit = Math.min(toNum(req.query.limit, 50), 200);
    const maxDistance = radiusMi * MI_TO_M;

    const results = await Town.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distanceMeters",
          spherical: true,
          maxDistance,
          key: "loc",
        },
      },
      {
        $project: {
          _id: 0,
          name: 1,
          state: 1,
          lat: 1,
          lng: 1,
          distanceMi: { $divide: ["$distanceMeters", MI_TO_M] },
        },
      },
      { $limit: limit },
    ]);

    const shaped = results.map((t: any) => ({
      label: `${t.name}, ${t.state} (${t.distanceMi.toFixed(1)} mi)`,
      name: t.name,
      state: t.state,
      lat: t.lat,
      lng: t.lng,
      distanceMi: t.distanceMi,
    }));

    res.json(shaped);
  } catch (err) {
    logger.error("[ActService] GET /acts/hometowns/near failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).send({ error: "Failed to search towns by radius" });
  }
});

/**
 * GET /acts/:id — Public (guard to only match ObjectId)
 */
router.get("/:id([0-9a-fA-F]{24})", async (req, res) => {
  try {
    const act: IAct | null = await Act.findById(req.params.id).lean();
    if (!act) return res.status(404).send({ error: "Not found" });
    res.send(act);
  } catch (err) {
    logger.error("[ActService] GET /acts/:id failed", {
      error: err instanceof Error ? err.message : String(err),
      actId: req.params.id,
    });
    res.status(500).send({ error: "Failed to fetch Act" });
  }
});

/**
 * PUT /acts/:id — Update Act (auth + ownership required)
 */
router.put("/:id", authenticate, async (req, res) => {
  try {
    const act = await Act.findById(req.params.id);
    if (!act) return res.status(404).send({ error: "Not found" });

    if (act.userOwnerId !== req.user?._id) {
      return res.status(403).send({ error: "Forbidden: Not the owner" });
    }

    const updates = {
      ...(req.body as IActUpdate),
      dateLastUpdated: dateNowIso(),
    };

    const updatedAct: IAct | null = await Act.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    ).lean();

    res.send(updatedAct);
  } catch (err) {
    if (
      err instanceof Error &&
      typeof (err as any).code === "number" &&
      (err as any).code === 11000
    ) {
      return res.status(409).send({
        error: "An Act with that name already exists in this homeTown.",
      });
    }
    logger.error("[ActService] PUT /acts/:id failed", {
      error: err instanceof Error ? err.message : String(err),
      actId: req.params.id,
    });
    res.status(500).send({ error: "Failed to update Act" });
  }
});

/**
 * DELETE /acts/:id — Delete Act (auth + ownership required)
 */
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const act = await Act.findById(req.params.id);
    if (!act) return res.status(404).send({ error: "Not found" });

    if (act.userOwnerId !== req.user?._id) {
      return res.status(403).send({ error: "Forbidden: Not the owner" });
    }

    await Act.findByIdAndDelete(req.params.id);
    res.send({ success: true });
  } catch (err) {
    logger.error("[ActService] DELETE /acts/:id failed", {
      error: err instanceof Error ? err.message : String(err),
      actId: req.params.id,
    });
    res.status(500).send({ error: "Failed to delete Act" });
  }
});

export default router;
