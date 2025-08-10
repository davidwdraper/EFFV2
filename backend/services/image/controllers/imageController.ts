import type { Request, Response } from "express";
import axios from "axios";
import FormData from "form-data";
import { logger } from "@shared/utils/logger";
import { ImageModel } from "../models/Image"; // adjust path if different

const IMAGE_BASE = process.env.SVC_IMAGE_BASE!; // e.g. http://image:4005
const USER_BASE = process.env.SVC_USER_BASE!; // e.g. http://user:4001
const SELF_BASE = process.env.PUBLIC_API_BASE!; // e.g. http://localhost:4000

// ---------- helpers ----------
const toDisplayName = (u: any) => {
  if (!u) return null;
  const f = (u.firstname ?? u.firstName ?? "").trim();
  const l = (u.lastname ?? u.lastName ?? "").trim();
  const both = `${f} ${l}`.trim();
  return both || u.eMailAddr || u.email || null;
};

async function fetchUserNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  try {
    const { data } = await axios.post(`${USER_BASE}/users/lookup`, { ids });
    const map: Record<string, string> = {};
    for (const u of Array.isArray(data) ? data : []) {
      const id = u.id || u._id;
      if (id) map[id] = toDisplayName(u);
    }
    return map;
  } catch (err: any) {
    logger.error("[orchestrator] fetchUserNames failed", { msg: err?.message });
    return {};
  }
}

type RawImage = {
  id: string;
  _id?: string;
  creationDate?: string | Date;
  notes?: string | null;
  createdBy?: string | null;
  state?: number | string;
};

function toDto(raw: RawImage, userNames: Record<string, string>) {
  const id = (raw.id as string) || (raw._id as string) || "";
  return {
    id,
    url: `${SELF_BASE}/images/${id}/data`,
    comment: raw.notes ?? null,
    createdByName: raw.createdBy ? userNames[raw.createdBy] ?? null : null,
    createdAt: raw.creationDate ?? null,
    state: raw.state ?? null,
  };
}

// ---------- READ CONTROLLERS ----------
export async function getImageMeta(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const { data: raw } = await axios.get(`${IMAGE_BASE}/images/${id}`, {
      // pass auth if your image svc needs it for reads
      headers: pickAuth(req.headers),
    });
    const userIds =
      raw?.createdBy && typeof raw.createdBy === "string"
        ? [raw.createdBy]
        : [];
    const userNames = await fetchUserNames(userIds);
    return res.json(toDto(raw as RawImage, userNames));
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] getImageMeta failed", {
      id,
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Failed to fetch image metadata" });
  }
}

export async function getImageData(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const resp = await axios.get(`${IMAGE_BASE}/images/${id}/data`, {
      responseType: "arraybuffer",
      headers: pickAuth(req.headers),
    });
    res.setHeader(
      "Content-Type",
      (resp.headers["content-type"] as string) || "application/octet-stream"
    );
    res.setHeader(
      "Cache-Control",
      (resp.headers["cache-control"] as string) ||
        "public, max-age=31536000, immutable"
    );
    return res.send(Buffer.from(resp.data));
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] getImageData failed", {
      id,
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Failed to fetch image data" });
  }
}

export async function postLookup(req: Request, res: Response) {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.json([]);
  try {
    const { data: raws } = await axios.post(
      `${IMAGE_BASE}/images/lookup`,
      { ids },
      { headers: pickAuth(req.headers) }
    );

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
    logger.error("[orchestrator] postLookup failed", {
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Failed to fetch images" });
  }
}

// ---------- WRITE CONTROLLERS ----------
const isHex24 = (s?: string) => !!s && /^[a-fA-F0-9]{24}$/.test(s);

export async function postUpload(req: Request, res: Response) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file)
      return res
        .status(400)
        .json({ error: "file is required (multipart field 'file')" });

    // Get user id from header (for direct svc tests) or from auth if you add it later
    const userId =
      (req.headers["x-user-id"] as string) ||
      (req as any).user?._id ||
      (req as any).user?.id;

    if (!isHex24(userId)) {
      return res
        .status(400)
        .json({ error: "x-user-id header (24-hex) required" });
    }

    const doc = await ImageModel.create({
      image: file.buffer,
      creationDate: new Date(),
      notes:
        typeof req.body?.notes === "string" ? req.body.notes.trim() : undefined,
      createdBy: userId, // required by schema
      originalFilename: file.originalname ?? undefined,
      contentType: file.mimetype ?? undefined,
    } as any);

    return res.status(201).json({
      id: doc._id.toString(),
      originalFilename: file.originalname ?? null,
      contentType: file.mimetype ?? null,
      size: file.size,
      state: "pending",
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: "Upload failed", detail: err?.message });
  }
}

export async function postFinalize(req: Request, res: Response) {
  try {
    const { imageIds } = req.body ?? {};
    const { data, status } = await axios.post(
      `${IMAGE_BASE}/images/finalize`,
      { imageIds: Array.isArray(imageIds) ? imageIds : [] },
      { headers: pickAuth(req.headers) }
    );
    return res.status(status).json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] postFinalize failed", {
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Finalize failed" });
  }
}

export async function postUnlink(req: Request, res: Response) {
  try {
    const { imageIds } = req.body ?? {};
    const { data, status } = await axios.post(
      `${IMAGE_BASE}/images/unlink`,
      { imageIds: Array.isArray(imageIds) ? imageIds : [] },
      { headers: pickAuth(req.headers) }
    );
    return res.status(status).json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] postUnlink failed", {
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Unlink failed" });
  }
}

export async function postDiscard(req: Request, res: Response) {
  try {
    const { uploadBatchId, imageIds } = req.body ?? {};
    const payload: any = {};
    if (typeof uploadBatchId === "string" && uploadBatchId.length) {
      payload.uploadBatchId = uploadBatchId;
    }
    if (Array.isArray(imageIds)) {
      payload.imageIds = imageIds;
    }
    const { data, status } = await axios.post(
      `${IMAGE_BASE}/images/discard`,
      payload,
      { headers: pickAuth(req.headers) }
    );
    return res.status(status).json(data);
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    logger.error("[orchestrator] postDiscard failed", {
      status,
      msg: err?.message,
    });
    return res.status(status).json({ error: "Discard failed" });
  }
}

// ---------- small util ----------
function pickAuth(h: Request["headers"]): Record<string, string> {
  const auth = h["authorization"];
  return auth ? { Authorization: Array.isArray(auth) ? auth[0] : auth } : {};
}
