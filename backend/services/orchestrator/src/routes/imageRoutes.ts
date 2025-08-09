import { Router, Request, Response } from "express";
import axios from "axios";
import { logger } from "@shared/utils/logger";

const router = Router();

// These should be set in your env (.env.dev / .env.docker, etc.)
const IMAGE_BASE = process.env.SVC_IMAGE_BASE!; // e.g. http://image:4005
const USER_BASE = process.env.SVC_USER_BASE!; // e.g. http://user:4001
const SELF_BASE = process.env.PUBLIC_API_BASE!; // e.g. http://localhost:4000

// --- helpers ---
const toDisplayName = (u: any) => {
  if (!u) return null;
  const f = (u.firstname ?? "").trim();
  const l = (u.lastname ?? "").trim();
  const both = `${f} ${l}`.trim();
  return both || u.eMailAddr || null;
};

async function fetchUserNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  try {
    // Assumes you have a batch lookup route on user service.
    const { data } = await axios.post(`${USER_BASE}/users/lookup`, { ids });
    const map: Record<string, string> = {};
    for (const u of Array.isArray(data) ? data : []) {
      map[u.id] = toDisplayName(u);
    }
    return map;
  } catch (err) {
    logger.error("[orchestrator] fetchUserNames failed", {
      err: (err as any)?.message,
    });
    return {};
  }
}

type RawImage = {
  id: string;
  creationDate: string | Date;
  notes?: string | null;
  createdBy?: string | null;
};

function toDto(raw: RawImage, userNames: Record<string, string>) {
  const id = raw.id;
  return {
    id,
    url: `${SELF_BASE}/images/${id}/data`,
    comment: raw.notes ?? null,
    createdByName: raw.createdBy ? userNames[raw.createdBy] ?? null : null,
    createdAt: raw.creationDate,
  };
}

/**
 * Proxy binary
 * GET /images/:id/data
 */
router.get("/:id/data", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const resp = await axios.get(`${IMAGE_BASE}/images/${id}/data`, {
      responseType: "arraybuffer",
    });
    res.setHeader(
      "Content-Type",
      resp.headers["content-type"] || "application/octet-stream"
    );
    res.setHeader(
      "Cache-Control",
      resp.headers["cache-control"] || "public, max-age=31536000, immutable"
    );
    return res.send(Buffer.from(resp.data));
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] GET /images/:id/data failed", {
      id,
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Failed to fetch image data" });
  }
});

/**
 * GET /images/:id
 * Enriched DTO
 */
router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const { data: raw } = await axios.get(`${IMAGE_BASE}/images/${id}`);
    // raw.createdBy may be undefined/null/non-string; guard and narrow to string[]
    const userIds: string[] =
      raw?.createdBy && typeof raw.createdBy === "string"
        ? [raw.createdBy]
        : [];
    const userNames = await fetchUserNames(userIds);
    return res.json(toDto(raw as RawImage, userNames));
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] GET /images/:id failed", {
      id,
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Failed to fetch image metadata" });
  }
});

/**
 * POST /images/lookup
 * Body: { ids: string[] }
 * Returns enriched DTOs, preserving order.
 */
router.post("/lookup", async (req: Request, res: Response) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.json([]);

  try {
    const { data: raws } = await axios.post(`${IMAGE_BASE}/images/lookup`, {
      ids,
    });

    // 🔧 Strict typing fix here:
    // - assert raws is an array
    // - pull createdBy
    // - filter with a type guard to ensure string[]
    const userIds: string[] = [
      ...new Set(
        (raws as any[])
          .map((r) => r?.createdBy)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    const userNames = await fetchUserNames(userIds);
    const dtos = (raws as RawImage[]).map((r) => toDto(r, userNames));
    return res.json(dtos);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] POST /images/lookup failed", {
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Failed to fetch images" });
  }
});

export default router;
