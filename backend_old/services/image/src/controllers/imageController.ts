// backend/services/image/src/controllers/imageController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Types } from "mongoose";
import ImageModel from "../models/Image";

/** ---------- Local utils ---------- */
const isHex24 = (s?: string) => !!s && /^[a-fA-F0-9]{24}$/.test(s);

type ImgDoc = {
  _id: any;
  creationDate?: Date | string | null;
  notes?: string | null;
  createdBy?: any;
  contentType?: string | null;
  originalFilename?: string | null;
  state?: any;
  moderation?: any;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
  checksum?: string | null;
  image?: Buffer;
};

type HttpErr = Error & { status?: number; code?: string };

/** Express-async wrapper (routes remain one-liners) */
const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const httpError = (status: number, message: string, code = "BAD_REQUEST") => {
  const e = new Error(message) as HttpErr;
  e.status = status;
  e.code = code;
  return e;
};

/** request.audit typing */
declare global {
  namespace Express {
    interface Request {
      audit?: Array<Record<string, any>>;
    }
  }
}

/** ---------- READ ---------- */
export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, scope: "image-svc", ts: new Date().toISOString() });
});

export const getImageMeta: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isHex24(id)) throw httpError(400, "Invalid id", "INVALID_ID");

  const doc = (await ImageModel.findById(id).lean()) as ImgDoc | null;
  if (!doc) throw httpError(404, "Not found", "NOT_FOUND");

  res.json({
    id: String(doc._id),
    creationDate: doc.creationDate ?? null,
    notes: doc.notes ?? null,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    contentType: doc.contentType ?? null,
    originalFilename: doc.originalFilename ?? null,
    state: doc.state ?? null,
    moderation: doc.moderation ?? null,
    bytes: doc.bytes ?? null,
    width: doc.width ?? null,
    height: doc.height ?? null,
    checksum: doc.checksum ?? null,
  });
});

/**
 * Optional HEAD endpoint for clients that want headers without the body.
 * Mirrors getImageData() caching + meta headers.
 */
export const headImageData: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isHex24(id)) throw httpError(400, "Invalid id", "INVALID_ID");

  const doc = await ImageModel.findById(id)
    .select(
      "contentType bytes checksum creationDate notes originalFilename createdBy state moderation width height"
    )
    .lean();

  if (!doc) throw httpError(404, "Not found", "NOT_FOUND");

  // Caching
  const bytes = (doc as any).bytes ?? 0;
  const etag = `"${(doc as any).checksum ?? `${id}:${bytes}`}"`;
  res.setHeader("ETag", etag);
  if (doc.creationDate) {
    res.setHeader(
      "Last-Modified",
      new Date(doc.creationDate as any).toUTCString()
    );
  }
  const ct = (doc as any).contentType || "application/octet-stream";
  res.setHeader("Content-Type", ct);
  if (bytes) res.setHeader("Content-Length", String(bytes));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

  // Meta-as-headers
  res.setHeader("X-Image-Id", String(doc._id));
  if ((doc as any).originalFilename)
    res.setHeader("X-Image-Filename", String((doc as any).originalFilename));
  if ((doc as any).checksum)
    res.setHeader("X-Image-Checksum", String((doc as any).checksum));
  if (bytes) res.setHeader("X-Image-Bytes", String(bytes));
  if ((doc as any).width)
    res.setHeader("X-Image-Width", String((doc as any).width));
  if ((doc as any).height)
    res.setHeader("X-Image-Height", String((doc as any).height));
  if ((doc as any).state)
    res.setHeader("X-Image-State", String((doc as any).state));
  if ((doc as any).moderation)
    res.setHeader("X-Image-Moderation", String((doc as any).moderation));
  if ((doc as any).createdBy)
    res.setHeader("X-Image-CreatedBy", String((doc as any).createdBy));
  if ((doc as any).notes)
    res.setHeader("X-Image-Notes", String((doc as any).notes));
  if (doc.creationDate)
    res.setHeader(
      "X-Image-CreationDate",
      new Date(doc.creationDate as any).toISOString()
    );

  res.status(200).end();
});

/**
 * Optimized to avoid loading the blob unless needed:
 *  - Fetch lean meta first, compute ETag and set meta headers.
 *  - If If-None-Match matches, return 304 without reading +image.
 *  - Otherwise fetch the blob and stream it.
 */
export const getImageData: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isHex24(id)) throw httpError(400, "Invalid id", "INVALID_ID");

  // Step 1: meta-only (lean) — cheap, no blob read
  const meta = await ImageModel.findById(id)
    .select(
      "contentType bytes checksum creationDate notes originalFilename createdBy state moderation width height"
    )
    .lean();

  if (!meta) throw httpError(404, "Not found", "NOT_FOUND");

  const bytes = (meta as any).bytes ?? 0;
  const etag = `"${(meta as any).checksum ?? `${id}:${bytes}`}"`;

  // Cache headers from meta
  res.setHeader("ETag", etag);
  if (meta.creationDate) {
    res.setHeader(
      "Last-Modified",
      new Date(meta.creationDate as any).toUTCString()
    );
  }

  // Meta-as-headers (one call returns meta + bytes)
  res.setHeader("X-Image-Id", String(meta._id));
  if ((meta as any).originalFilename)
    res.setHeader("X-Image-Filename", String((meta as any).originalFilename));
  if ((meta as any).checksum)
    res.setHeader("X-Image-Checksum", String((meta as any).checksum));
  if (bytes) res.setHeader("X-Image-Bytes", String(bytes));
  if ((meta as any).width)
    res.setHeader("X-Image-Width", String((meta as any).width));
  if ((meta as any).height)
    res.setHeader("X-Image-Height", String((meta as any).height));
  if ((meta as any).state)
    res.setHeader("X-Image-State", String((meta as any).state));
  if ((meta as any).moderation)
    res.setHeader("X-Image-Moderation", String((meta as any).moderation));
  if ((meta as any).createdBy)
    res.setHeader("X-Image-CreatedBy", String((meta as any).createdBy));
  if ((meta as any).notes)
    res.setHeader("X-Image-Notes", String((meta as any).notes));
  if (meta.creationDate)
    res.setHeader(
      "X-Image-CreationDate",
      new Date(meta.creationDate as any).toISOString()
    );

  // Conditional GET: if client cache matches, do NOT load blob
  const inm = req.headers["if-none-match"];
  if (typeof inm === "string" && inm === etag) {
    res.status(304).end();
    return;
  }

  // Step 2: fetch blob only if necessary
  const docWithBlob = await ImageModel.findById(id)
    .select("+image contentType")
    .exec();

  if (!docWithBlob || !Buffer.isBuffer((docWithBlob as any).image)) {
    throw httpError(500, "Image binary missing", "NO_BINARY");
  }

  const buf = (docWithBlob as any).image as Buffer;
  const ct =
    (docWithBlob as any).contentType ||
    (meta as any).contentType ||
    "application/octet-stream";

  res.setHeader("Content-Type", ct);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Content-Length", String(buf.length));
  res.status(200).end(buf);
});

export const postLookup: RequestHandler = asyncHandler(async (req, res) => {
  const ids: string[] = (
    Array.isArray(req.body?.ids) ? req.body.ids : []
  ).filter((x: unknown): x is string => typeof x === "string" && isHex24(x));

  if (!ids.length) {
    res.json([]);
    return;
  }

  const objIds = ids.map((s) => new Types.ObjectId(s));
  const docs = (await ImageModel.find({
    _id: { $in: objIds },
  }).lean()) as ImgDoc[];

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
      moderation: doc.moderation ?? null,
      bytes: doc.bytes ?? null,
      width: doc.width ?? null,
      height: doc.height ?? null,
      checksum: doc.checksum ?? null,
    }));

  res.json(out);
});

/** ---------- WRITE ---------- */
export const postUpload: RequestHandler = asyncHandler(async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file)
    throw httpError(
      400,
      "file is required (multipart field 'file')",
      "FILE_REQUIRED"
    );

  // createdBy required by schema
  const userId =
    (req as any).user?._id ||
    (req as any).user?.id ||
    (req.headers["x-user-id"] as string | undefined);

  if (!isHex24(userId))
    throw httpError(
      400,
      "x-user-id header (24-hex) required",
      "USER_HEADER_REQUIRED"
    );

  const doc = await ImageModel.create({
    image: file.buffer,
    // creationDate defaults via schema; setting explicitly is fine:
    creationDate: new Date(),
    notes:
      typeof req.body?.notes === "string" ? req.body.notes.trim() : undefined,
    createdBy: new Types.ObjectId(userId),
    originalFilename: file.originalname ?? undefined,
    contentType: file.mimetype ?? undefined,
    // bytes auto-filled by pre('save') if missing
    // state defaults to 'orphan'; moderation defaults to 'pending'
  } as any);

  // Audit
  req.audit?.push({
    type: "image:create",
    id: String(doc._id),
    bytes: file.size,
    contentType: file.mimetype ?? null,
    originalFilename: file.originalname ?? null,
  });

  res.setHeader("Location", `/images/${String(doc._id)}`);
  res.status(201).json({
    id: String(doc._id),
    originalFilename: file.originalname ?? null,
    contentType: file.mimetype ?? null,
    size: file.size,
    state: "orphan",
    moderation: "pending",
  });
});

export const postFinalize: RequestHandler = asyncHandler(async (req, res) => {
  // Stub for future state transition (e.g., orphan->linked after entity association)
  req.audit?.push({ type: "image:finalize:noop" });
  res.json({ ok: true });
});

export const postUnlink: RequestHandler = asyncHandler(async (req, res) => {
  // Stub for future unlink (e.g., linked->orphan + set expiresAtDate for TTL)
  req.audit?.push({ type: "image:unlink:noop" });
  res.json({ ok: true });
});

export const postDiscard: RequestHandler = asyncHandler(async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.imageIds)
    ? req.body.imageIds
    : [];
  const validObjIds = ids.filter(isHex24).map((s) => new Types.ObjectId(s));

  if (!validObjIds.length) {
    res.json({ deleted: 0 });
    return;
  }

  // If you prefer soft delete later, switch to updateMany({state:"deleted"}) and clear image
  const r = await ImageModel.deleteMany({ _id: { $in: validObjIds } });

  req.audit?.push({
    type: "image:discard",
    count: r.deletedCount ?? 0,
    ids: validObjIds.map(String),
  });

  res.json({ deleted: r.deletedCount ?? 0 });
});
