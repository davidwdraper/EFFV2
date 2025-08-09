import { Router, Request, Response } from "express";
import axios from "axios";

const router = Router();

const ACT_BASE = process.env.SVC_ACT_BASE!; // http://act:4002
const IMAGE_BASE = process.env.SVC_IMAGE_BASE!; // http://image:4005
const SELF_BASE = process.env.PUBLIC_API_BASE!; // http://localhost:4000

type RawSorted = {
  id: string;
  creationDate: string | Date;
  notes?: string | null;
  createdBy?: string | null;
};

/**
 * GET /acts/:id/images?skip=&limit=
 *
 * Paging model (entire list perspective, where index 0 is always the primary if present):
 * - If skip === 0: return [primary] + first page of tail (newest-first) up to `limit` total items.
 * - If skip  >  0: return only tail items, skipping (skip - 1) from the tail, up to `limit`.
 *
 * Response:
 * {
 *   items: ImageDto[],      // dto: { id, url, comment, createdByName, createdAt }
 *   total: number,          // total images incl. primary
 *   skip: number,
 *   limit: number,
 *   hasMore: boolean
 * }
 */
router.get("/:id/images", async (req: Request, res: Response) => {
  const { id } = req.params;
  const skip = Math.max(0, parseInt(String(req.query.skip ?? "0"), 10) || 0);
  const limit = Math.max(
    1,
    parseInt(String(req.query.limit ?? "12"), 10) || 12
  );

  try {
    // 1) Fetch Act to get imageIds (primary is imageIds[0])
    const { data: act } = await axios.get(`${ACT_BASE}/acts/${id}`);
    const imageIds: string[] = Array.isArray(act?.imageIds)
      ? act.imageIds.filter((x: any) => typeof x === "string")
      : [];
    const total = imageIds.length;

    if (total === 0) {
      return res.json({ items: [], total: 0, skip, limit, hasMore: false });
    }

    const primary = imageIds[0] || null;
    const tailIds = imageIds.slice(1); // items eligible for date-desc sorting/paging
    const tailCount = tailIds.length;

    // 2) Determine how many we need from the tail for this page
    let idsForLookup: string[] = [];
    let hasMore = false;

    if (skip === 0) {
      // Include primary + (limit - 1) from the tail (sorted by date desc)
      const wantedFromTail = Math.max(0, limit - 1);
      let tailPage: RawSorted[] = [];
      if (wantedFromTail > 0 && tailCount > 0) {
        const { data: page } = await axios.post<RawSorted[]>(
          `${IMAGE_BASE}/images/sortedByDate`,
          { ids: tailIds, skip: 0, limit: wantedFromTail, order: "desc" }
        );
        tailPage = Array.isArray(page) ? page : [];
      }
      const tailIdsPage = tailPage.map((r) => r.id);
      idsForLookup = [primary!, ...tailIdsPage].filter(Boolean);
      hasMore = total > idsForLookup.length; // any remaining images?
    } else {
      // Skipping into the list: skip-1 into the tail (primary occupies index 0)
      const tailSkip = Math.max(0, skip - 1);
      let tailPage: RawSorted[] = [];
      if (tailCount > 0 && tailSkip < tailCount) {
        const { data: page } = await axios.post<RawSorted[]>(
          `${IMAGE_BASE}/images/sortedByDate`,
          { ids: tailIds, skip: tailSkip, limit, order: "desc" }
        );
        tailPage = Array.isArray(page) ? page : [];
      }
      idsForLookup = tailPage.map((r) => r.id);
      hasMore = skip + idsForLookup.length < total;
    }

    if (idsForLookup.length === 0) {
      return res.json({ items: [], total, skip, limit, hasMore: false });
    }

    // 3) Enrich to DTOs in the same order
    const { data: dtos } = await axios.post(`${SELF_BASE}/images/lookup`, {
      ids: idsForLookup,
    });

    return res.json({
      items: Array.isArray(dtos) ? dtos : [],
      total,
      skip,
      limit,
      hasMore,
    });
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res
      .status(status)
      .json({
        error: "Failed to load act images",
        details: err?.message ?? "unknown error",
      });
  }
});

export default router;
