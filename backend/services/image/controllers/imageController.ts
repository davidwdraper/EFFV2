// backend/services/image/src/controllers/imageController.ts
import type { Request, Response } from "express";
import { Types } from "mongoose";
import { ImageModel } from "../models/Image";

const isHex24 = (s?: string) => !!s && /^[a-fA-F0-9]{24}$/.test(s);

// Lean doc shape (adjust if your schema differs)
type ImgDoc = {
  _id: any;
  creationDate?: Date | string | null;
  notes?: string | null;
  createdBy?: any;
  contentType?: string | null;
  originalFilename?: string | null;
  state?: any;
  image?: Buffer;
};

// ---------- READ ----------
export async function getImageMeta(req: Request, res: Response) {
  const { id } = req.params;
  if (!isHex24(id)) return res.status(400).json({ error: "Invalid id" });

  const doc = (await ImageModel.findById(id).lean()) as ImgDoc | null;
  if (!doc) return res.status(404).json({ error: "Not found" });

  return res.json({
    id: String(doc._id),
    creationDate: doc.creationDate ?? null,
    notes: doc.notes ?? null,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    contentType: doc.contentType ?? null,
    originalFilename: doc.originalFilename ?? null,
    state: doc.state ?? null,
  });
}

export async function getImageData(req: Request, res: Response) {
  const { id } = req.params;
  if (!isHex24(id)) return res.status(400).json({ error: "Invalid id" });

  // IMPORTANT: fetch as a doc (no lean) and opt-in to hidden blob
  const doc = await ImageModel.findById(id).select("+image contentType").exec();

  if (!doc) return res.status(404).json({ error: "Not found" });

  const buf = doc.image as unknown as Buffer;
  if (!Buffer.isBuffer(buf)) {
    return res.status(500).json({ error: "Image binary missing" });
  }

  const ct = doc.contentType || "application/octet-stream";
  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Content-Length", String(buf.byteLength));
  return res.status(200).end(buf);
}

export async function postLookup(req: Request, res: Response) {
  // Typed + validated ids
  const ids: string[] = (
    Array.isArray(req.body?.ids) ? req.body.ids : []
  ).filter((x: unknown): x is string => typeof x === "string" && isHex24(x));

  if (!ids.length) return res.json([]);

  const objIds = ids.map((s) => new Types.ObjectId(s));
  const docs = (await ImageModel.find({
    _id: { $in: objIds },
  }).lean()) as ImgDoc[];

  // Preserve input order; skip missing
  const map = new Map<string, ImgDoc>(
    docs.map((d) => [String(d._id), d] as const)
  );

  const out = ids
    .map((id) => map.get(id))
    .filter((d): d is ImgDoc => Boolean(d))
    .map((doc) => ({
      id: String(doc._id),
      creationDate: doc.creationDate ?? null,
      notes: doc.notes ?? null,
      createdBy: doc.createdBy ? String(doc.createdBy) : null,
      contentType: doc.contentType ?? null,
      originalFilename: doc.originalFilename ?? null,
      state: doc.state ?? null,
    }));

  return res.json(out);
}

// ---------- WRITE ----------
export async function postUpload(req: Request, res: Response) {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res
        .status(400)
        .json({ error: "file is required (multipart field 'file')" });
    }

    // createdBy is required by your schema
    const userId =
      (req as any).user?._id ||
      (req as any).user?.id ||
      (req.headers["x-user-id"] as string);

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
      createdBy: new Types.ObjectId(userId),
      originalFilename: file.originalname ?? undefined,
      contentType: file.mimetype ?? undefined,
      // uploadBatchId: req.body?.uploadBatchId ?? undefined, // add to schema if desired
      // state: "pending",
    } as any);

    res.setHeader("Location", `/images/${doc._id.toString()}`);
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

export async function postFinalize(_req: Request, res: Response) {
  // TODO: implement if you track state; stubbed for now
  return res.json({ ok: true });
}

export async function postUnlink(_req: Request, res: Response) {
  // TODO: implement entity-image unlink logic; stubbed for now
  return res.json({ ok: true });
}

export async function postDiscard(req: Request, res: Response) {
  try {
    const ids: string[] = Array.isArray(req.body?.imageIds)
      ? req.body.imageIds
      : [];
    const valid = ids.filter(isHex24).map((s) => new Types.ObjectId(s));
    if (!valid.length) return res.json({ deleted: 0 });

    const r = await ImageModel.deleteMany({ _id: { $in: valid } });
    return res.json({ deleted: r.deletedCount ?? 0 });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: "Discard failed", detail: err?.message });
  }
}
