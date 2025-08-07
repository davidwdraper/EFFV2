import express, { Request, Response } from "express";
import Town from "../models/Town";

const router = express.Router();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /towns/typeahead?q=Tam&limit=10
router.get("/typeahead", async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limitNum = Number(req.query.limit ?? 10);
    const limit = Math.min(
      Math.max(Number.isFinite(limitNum) ? limitNum : 10, 1),
      50
    );

    if (q.length < 3) return res.status(200).json({ count: 0, data: [] });

    const rx = new RegExp("^" + esc(q), "i");
    const towns = await Town.find(
      { name: rx },
      { name: 1, state: 1, lat: 1, lng: 1 }
    )
      .limit(limit)
      .lean();

    const data = towns.map((t: any) => ({
      label: `${t.name}, ${t.state}`,
      name: t.name,
      state: t.state,
      lat: t.lat,
      lng: t.lng,
      townId: t._id?.toString(),
    }));

    res.status(200).json({ count: data.length, data });
  } catch (err: any) {
    console.error("[towns/typeahead] error:", err);
    res
      .status(500)
      .json({
        error: "Failed to fetch towns",
        detail: err?.message ?? String(err),
      });
  }
});

export default router;
