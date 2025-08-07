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
 * GET /acts/townload — Admin-only: Load towns from CSV to Mongo
 */
router.get("/townload", authenticate, async (req, res) => {
  try {
    if (!req.user || req.user.userType < 3) {
      return res.status(403).send({ error: "Admin access only" });
    }

    const csvUrl = "https://simplemaps.com/static/data/us-cities/uscities.csv";
    const response = await axios.get(csvUrl, { responseType: "stream" });

    const towns: { name: string; state: string; lat: number; lng: number }[] =
      [];

    const parser = response.data.pipe(csvParser());

    for await (const row of parser) {
      if (!row.city || !row.state_id || !row.lat || !row.lng) continue;

      towns.push({
        name: row.city,
        state: row.state_id,
        lat: parseFloat(row.lat),
        lng: parseFloat(row.lng),
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
 * GET /acts/:id — Public
 */
router.get("/:id", async (req, res) => {
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
