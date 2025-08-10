import { Router, Request, Response } from "express";
import axios from "axios";
import multer from "multer";
import FormData from "form-data";
import { logger } from "@shared/utils/logger";
import { authenticate } from "@shared/middleware/authenticate";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Service bases
const IMAGE_BASE = process.env.SVC_IMAGE_BASE!; // e.g., http://localhost:4005
const USER_BASE = process.env.SVC_USER_BASE!; // e.g., http://localhost:4001
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
    for (const u of Array.isArray(data) ? data : [])
      map[u.id] = toDisplayName(u);
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

// ---- handlers ----
export async function getImageDataHandler(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const upstream = await axios.get(`${IMAGE_BASE}/images/${id}/data`, {
      responseType: "stream",
      validateStatus: () => true,
    });

    if (upstream.status >= 400) {
      logger.error("[orchestrator] GET /images/:id/data failed", {
        id,
        status: upstream.status,
      });
      return res
        .status(upstream.status)
        .json({ error: "Failed to fetch image data" });
    }

    const ct = upstream.headers["content-type"] || "application/octet-stream";
    const cc =
      upstream.headers["cache-control"] ||
      "public, max-age=31536000, immutable";
    res.setHeader("Content-Type", String(ct));
    res.setHeader("Cache-Control", String(cc));
    res.status(200);
    upstream.data.pipe(res);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] GET /images/:id/data error", {
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

/**
 * POST /images  (upload proxy)
 * Accepts multipart form-data with field "file" and optional "uploadBatchId".
 * Proxies to image service POST /image.
 */
export async function postUploadProxy(req: Request, res: Response) {
  try {
    const file = (req as any).file;
    if (!file)
      return res
        .status(400)
        .json({ error: "file is required (multipart field 'file')" });

    const form = new FormData();
    form.append("file", file.buffer, {
      filename: file.originalname || "upload.bin",
      contentType: file.mimetype || "application/octet-stream",
      knownLength: file.size,
    });

    const uploadBatchId = (req.body?.uploadBatchId ?? "").toString();
    if (uploadBatchId) form.append("uploadBatchId", uploadBatchId);

    const upstream = await axios.post(`${IMAGE_BASE}/image`, form, {
      headers: {
        ...form.getHeaders(),
        Accept: "application/json",
        Authorization: (req.headers.authorization as string) || "",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });

    return res
      .status(upstream.status)
      .set(upstream.headers)
      .send(upstream.data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] POST /images upload failed", {
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Upload failed" });
  }
}

export async function postFinalizeProxy(req: Request, res: Response) {
  try {
    const { data } = await axios.post(
      `${IMAGE_BASE}/images/finalize`,
      req.body,
      {
        headers: { Authorization: (req.headers.authorization as string) || "" },
        validateStatus: () => true,
      }
    );
    return res.status(200).json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res.status(status).json({ error: "Finalize failed" });
  }
}

export async function postUnlinkProxy(req: Request, res: Response) {
  try {
    const { data } = await axios.post(`${IMAGE_BASE}/images/unlink`, req.body, {
      headers: { Authorization: (req.headers.authorization as string) || "" },
      validateStatus: () => true,
    });
    return res.status(200).json(data);
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
        headers: { Authorization: (req.headers.authorization as string) || "" },
        validateStatus: () => true,
      }
    );
    return res.status(200).json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    return res.status(status).json({ error: "Discard failed" });
  }
}

// ---- routes (mounted at /images in app.ts) ----
// Keep static/lookup before :id routes; constrain :id to 24-hex.
router.post("/lookup", postImagesLookupHandler);
router.get("/:id([a-fA-F0-9]{24})/data", getImageDataHandler);
router.get("/:id([a-fA-F0-9]{24})", getImageMetaHandler);

// Mutating endpoints (require auth here; authGate also enforces)
router.post("/", authenticate, upload.single("file"), postUploadProxy); // ✅ THIS is POST /images
router.post("/finalize", authenticate, postFinalizeProxy);
router.post("/unlink", authenticate, postUnlinkProxy);
router.post("/discard", authenticate, postDiscardProxy);

export default router;
