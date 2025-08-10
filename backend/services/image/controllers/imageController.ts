import { Request, Response } from "express";
import { Types } from "mongoose";
import { ImageModel, IImage } from "../models/Image";

const ORPHAN_TTL_HOURS = Number(process.env.IMAGE_ORPHAN_TTL_HOURS ?? 48);

const nowPlusHours = (h: number) => new Date(Date.now() + h * 3600 * 1000);

const isValidObjectId = (id: unknown): id is string =>
  typeof id === "string" && Types.ObjectId.isValid(id);

function pickOrder<T extends { id: string }>(ids: string[], docs: T[]) {
  const map = new Map(docs.map((d) => [d.id, d]));
  return ids.map((id) => map.get(id)).filter(Boolean) as T[];
}

// ---------- READ ----------

export async function getImageMeta(req: Request, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ error: "bad id" });

  const doc = await ImageModel.findById(id).lean<IImage>().exec();
  if (!doc) return res.status(404).json({ error: "not found" });

  return res.json({
    id: String(doc._id),
    state: doc.state,
    creationDate: doc.creationDate,
    notes: doc.notes ?? null,
    createdBy: String(doc.createdBy),
    contentType: doc.contentType ?? null,
    originalFilename: doc.originalFilename ?? null,
  });
}

export async function getImageData(req: Request, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ error: "bad id" });

  const doc = await ImageModel.findById(id)
    .select({ image: 1, contentType: 1 })
    .lean<{ image: Buffer; contentType?: string }>()
    .exec();

  if (!doc) return res.status(404).json({ error: "not found" });

  res.setHeader("Content-Type", doc.contentType || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(Buffer.from(doc.image));
}

export async function postLookup(req: Request, res: Response) {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.json([]);

  const validIds = ids.filter(isValidObjectId);
  const docs = await ImageModel.find({ _id: { $in: validIds } })
    .select({
      _id: 1,
      creationDate: 1,
      notes: 1,
      createdBy: 1,
      contentType: 1,
      originalFilename: 1,
      state: 1,
    })
    .lean<IImage[]>()
    .exec();

  const shaped = docs.map((d) => ({
    id: String(d._id),
    creationDate: d.creationDate,
    notes: d.notes ?? null,
    createdBy: String(d.createdBy),
    contentType: d.contentType ?? null,
    originalFilename: d.originalFilename ?? null,
    state: d.state,
  }));

  return res.json(pickOrder(validIds, shaped));
}

// ---------- WRITE ----------

/**
 * POST /images
 * multipart/form-data with field "file"
 * Requires req.user.id (set by upstream auth) or req.headers['x-user-id'] fallback.
 */
export async function postUpload(req: Request, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;
  const notes =
    typeof req.body?.notes === "string" ? req.body.notes : undefined;
  const uploadBatchId =
    typeof req.body?.uploadBatchId === "string" && req.body.uploadBatchId.trim()
      ? req.body.uploadBatchId.trim()
      : undefined;

  if (!file) return res.status(400).json({ error: "file missing" });

  // Expect an upstream auth middleware to stamp req.user.id
  const userId =
    (req as any)?.user?.id ||
    (typeof req.headers["x-user-id"] === "string" &&
      req.headers["x-user-id"]) ||
    null;
  if (!userId || !isValidObjectId(userId))
    return res.status(401).json({ error: "unauthorized" });

  const doc = await ImageModel.create({
    uploadBatchId,
    image: file.buffer,
    contentType: file.mimetype,
    originalFilename: file.originalname,
    bytes: file.size,
    creationDate: new Date(),
    expiresAtDate: nowPlusHours(ORPHAN_TTL_HOURS),
    state: "orphan",
    notes,
    createdBy: new Types.ObjectId(userId),
  });

  return res.status(201).json({
    id: String(doc._id),
    state: doc.state,
    uploadBatchId: doc.uploadBatchId ?? null,
    creationDate: doc.creationDate,
    contentType: doc.contentType ?? null,
    originalFilename: doc.originalFilename ?? null,
  });
}

/**
 * POST /images/finalize  { imageIds: [] }
 * Set state => linked, clear TTL for each id.
 */
export async function postFinalize(req: Request, res: Response) {
  const imageIds: string[] = Array.isArray(req.body?.imageIds)
    ? req.body.imageIds
    : [];
  if (!imageIds.length) return res.json({ linked: [], skipped: [] });

  const ids = imageIds
    .filter(isValidObjectId)
    .map((id) => new Types.ObjectId(id));

  const result = await ImageModel.updateMany(
    { _id: { $in: ids }, state: { $in: ["orphan", "linked"] } }, // idempotent
    { $set: { state: "linked" as const, expiresAtDate: undefined } }
  );

  // Best-effort: report linked vs skipped (not_found or deleted)
  const found = await ImageModel.find({ _id: { $in: ids } })
    .select({ _id: 1, state: 1 })
    .lean()
    .exec();

  const linked: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const foundMap = new Map(found.map((d) => [String(d._id), d.state]));
  for (const id of imageIds) {
    const st = foundMap.get(id);
    if (!st) skipped.push({ id, reason: "not_found" });
    else if (st === "deleted") skipped.push({ id, reason: "deleted" });
    else linked.push(id);
  }

  return res.json({ linked, skipped, matched: result.matchedCount });
}

/**
 * POST /images/unlink  { imageIds: [] }
 * Set state => orphan and set TTL.
 */
export async function postUnlink(req: Request, res: Response) {
  const imageIds: string[] = Array.isArray(req.body?.imageIds)
    ? req.body.imageIds
    : [];
  if (!imageIds.length) return res.json({ orphaned: [], skipped: [] });

  const ids = imageIds
    .filter(isValidObjectId)
    .map((id) => new Types.ObjectId(id));

  await ImageModel.updateMany(
    { _id: { $in: ids }, state: { $in: ["linked", "orphan"] } }, // idempotent-friendly
    {
      $set: {
        state: "orphan" as const,
        expiresAtDate: nowPlusHours(ORPHAN_TTL_HOURS),
      },
    }
  );

  const found = await ImageModel.find({ _id: { $in: ids } })
    .select({ _id: 1, state: 1 })
    .lean()
    .exec();

  const orphaned: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const foundMap = new Map(found.map((d) => [String(d._id), d.state]));
  for (const id of imageIds) {
    const st = foundMap.get(id);
    if (!st) skipped.push({ id, reason: "not_found" });
    else if (st === "deleted") skipped.push({ id, reason: "deleted" });
    else orphaned.push(id);
  }

  return res.json({ orphaned, skipped });
}

/**
 * POST /images/discard  { uploadBatchId?: string, imageIds?: [] }
 * Hard delete images ONLY if state === orphan.
 */
export async function postDiscard(req: Request, res: Response) {
  const uploadBatchId =
    typeof req.body?.uploadBatchId === "string"
      ? req.body.uploadBatchId
      : undefined;
  const imageIds: string[] = Array.isArray(req.body?.imageIds)
    ? req.body.imageIds
    : [];

  if (!uploadBatchId && !imageIds.length) {
    return res
      .status(400)
      .json({ error: "uploadBatchId or imageIds required" });
  }

  const filter: any = { state: "orphan" };

  if (uploadBatchId) filter.uploadBatchId = uploadBatchId;
  if (imageIds.length) {
    const ids = imageIds
      .filter(isValidObjectId)
      .map((id) => new Types.ObjectId(id));
    filter._id = { $in: ids };
  }

  const toDelete = await ImageModel.find(filter)
    .select({ _id: 1 })
    .lean()
    .exec();
  const idsToDelete = toDelete.map((d) => d._id);

  await ImageModel.deleteMany({ _id: { $in: idsToDelete } }).exec();

  const deleted = idsToDelete.map(String);
  const requested = imageIds.length ? imageIds : deleted; // best-effort
  const skipped = requested
    .filter((id) => !deleted.includes(id))
    .map((id) => ({ id, reason: "not_orphan_or_not_found" }));

  return res.json({ deleted, skipped });
}
