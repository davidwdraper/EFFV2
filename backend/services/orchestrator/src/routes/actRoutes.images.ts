import { Router, Request, Response } from "express";
import axios from "axios";

const router = Router();

const ACT_BASE = process.env.SVC_ACT_BASE!; // http://act:4002
const SELF_BASE = process.env.PUBLIC_API_BASE!; // http://localhost:4000

// GET /acts/:id/images
// Rules:
// - Keep imageIds[0] (if present) as primary (index 0).
// - Sort the rest by createdAt (creationDate) DESC.
router.get("/:id/images", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const { data: act } = await axios.get(`${ACT_BASE}/acts/${id}`); // must include imageIds: string[]
    const imageIds: string[] = Array.isArray(act?.imageIds) ? act.imageIds : [];

    if (!imageIds.length) return res.json([]);

    const primary = imageIds[0];
    const tail = imageIds.slice(1);

    // Fetch enriched DTOs (orchestrator image lookup)
    const resp = await axios.post(`${SELF_BASE}/images/lookup`, {
      ids: imageIds,
    });
    const dtos: any[] = Array.isArray(resp.data) ? resp.data : [];

    // Build map for createdAt
    const byId = new Map<string, any>(dtos.map((d) => [d.id, d]));

    const primaryDto = byId.get(primary);
    const tailDtos = tail
      .map((tid) => byId.get(tid))
      .filter(Boolean)
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    // Final: primary first (if exists), then sorted tail
    const result = primaryDto ? [primaryDto, ...tailDtos] : tailDtos;
    return res.json(result);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res.status(status).json({ error: "Failed to load act images" });
  }
});

export default router;
