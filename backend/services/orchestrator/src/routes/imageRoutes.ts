import { Router, Request, Response } from "express";
import axios from "axios";
import { logger } from "@shared/utils/logger";
import { authenticate } from "@shared/middleware/authenticate";

const router = Router();

// Service bases
const IMAGE_BASE = process.env.SVC_IMAGE_BASE!; // e.g., http://image:4005
const USER_BASE = process.env.SVC_USER_BASE!; // e.g., http://user:4001
const SELF_BASE = process.env.PUBLIC_API_BASE!; // e.g., http://localhost:4000

// ---- types ----
type RawImage = {
  id: string;
  creationDate: string | Date;
  notes?: string | null;
  createdBy?: string | null;
  contentType?: string | null;
  originalFilename?: string | null;
  state?: string;
};

// ---- helpers ----
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
    const { data } = await axios.post(`${USER_BASE}/users/lookup`, { ids });
    const map: Record<string, string> = {};
    for (const u of Array.isArray(data) ? data : []) {
      map[u.id] = toDisplayName(u);
    }
    return map;
  } catch (err: any) {
    logger.error("[orchestrator] fetchUserNames failed", { msg: err?.message });
    return {};
  }
}

function toDto(raw: RawImage, userNames: Record<string, string>) {
  const id = raw.id;
  return {
    id,
    url: `${SELF_BASE}/images/${id}/data`,
    comment: raw.notes ?? null,
    createdByName: raw.createdBy ? userNames[raw.createdBy] ?? null : null,
    createdAt: raw.creationDate,
    contentType: raw.contentType ?? null,
    originalFilename: raw.originalFilename ?? null,
    state: raw.state ?? null,
  };
}

// ---- handlers (exported for tests if needed) ----
export async function getImageDataHandler(req: Request, res: Response) {
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
}

export async function getImageMetaHandler(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const { data: raw } = await axios.get(`${IMAGE_BASE}/images/${id}`);
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
}

export async function postImagesLookupHandler(req: Request, res: Response) {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.json([]);

  try {
    const { data: raws } = await axios.post(`${IMAGE_BASE}/images/lookup`, {
      ids,
    });

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
}

// ---- pass-through mutating routes (require auth here) ----

/**
 * POST /images
 * Proxy multipart upload to image service.
 */
export async function postUploadProxy(req: Request, res: Response) {
  try {
    // Expect upstream multer? No—proxy raw body/headers with axios is tricky.
    // Simpler: this route should NOT parse body. Mount a multer here too, then re-send as form-data.
    // To avoid double work, let clients call the IMAGE_BASE directly in internal networks.
    return res
      .status(501)
      .json({
        error:
          "Upload via orchestrator not implemented. Call image service directly or add multer proxy here.",
      });
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res.status(status).json({ error: "Upload failed" });
  }
}

export async function postFinalizeProxy(req: Request, res: Response) {
  try {
    const { data } = await axios.post(
      `${IMAGE_BASE}/images/finalize`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization || "" },
      }
    );
    return res.json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res.status(status).json({ error: "Finalize failed" });
  }
}

export async function postUnlinkProxy(req: Request, res: Response) {
  try {
    const { data } = await axios.post(`${IMAGE_BASE}/images/unlink`, req.body, {
      headers: { Authorization: req.headers.authorization || "" },
    });
    return res.json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res.status(status).json({ error: "Unlink failed" });
  }
}

export async function postDiscardProxy(req: Request, res: Response) {
  try {
    const { data } = await axios.post(
      `${IMAGE_BASE}/images/discard`,
      req.body,
      {
        headers: { Authorization: req.headers.authorization || "" },
      }
    );
    return res.json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res.status(status).json({ error: "Discard failed" });
  }
}

// ---- routes ----
router.get("/:id/data", getImageDataHandler);
router.get("/:id", getImageMetaHandler);
router.post("/lookup", postImagesLookupHandler);

// Require auth for mutating endpoints
router.post("/finalize", authenticate, postFinalizeProxy);
router.post("/unlink", authenticate, postUnlinkProxy);
router.post("/discard", authenticate, postDiscardProxy);

// NOTE: Upload via orchestrator is marked 501 to avoid double-multer complexity.
// If you want it here, wire multer like in the image service and forward as form-data.
// router.post("/", authenticate, postUploadProxy);

export default router;
