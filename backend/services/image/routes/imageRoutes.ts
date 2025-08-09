import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { ImageModel } from "../models/Image";

const router = Router();

/**
 * GET /images/:id/data
 * Streams raw binary buffer.
 */
router.get("/:id/data", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id))
    return res.status(400).json({ error: "Invalid id" });

  const img = await ImageModel.findById(id).lean();
  if (!img || !img.image) return res.status(404).json({ error: "Not found" });

  // You can try to detect mime if you stored it; default to octet-stream.
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(img.image);
});

/**
 * GET /images/:id
 * Raw metadata (no enrichment). Orchestrator will map to DTO.
 */
router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id))
    return res.status(400).json({ error: "Invalid id" });

  const img = await ImageModel.findById(id)
    .select("_id creationDate notes createdBy")
    .lean();
  if (!img) return res.status(404).json({ error: "Not found" });
  return res.json({
    id: img._id.toString(),
    creationDate: img.creationDate,
    notes: img.notes ?? null,
    createdBy: img.createdBy?.toString() ?? null,
  });
});

/**
 * POST /images/lookup
 * Body: { ids: string[] }
 * Returns raw metadata array (no enrichment). Preserves input order.
 */
router.post("/lookup", async (req: Request, res: Response) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.json([]);

  const validIds = ids
    .filter((x) => mongoose.isValidObjectId(x))
    .map((x) => new mongoose.Types.ObjectId(x));
  if (!validIds.length) return res.json([]);

  const docs = await ImageModel.find({ _id: { $in: validIds } })
    .select("_id creationDate notes createdBy")
    .lean();

  const map = new Map<string, any>();
  docs.forEach((d) =>
    map.set(d._id.toString(), {
      id: d._id.toString(),
      creationDate: d.creationDate,
      notes: d.notes ?? null,
      createdBy: d.createdBy?.toString() ?? null,
    })
  );

  // Preserve requested order; omit missing silently
  const ordered = ids.map((x) => map.get(x)).filter(Boolean);
  return res.json(ordered);
});

export default router;
