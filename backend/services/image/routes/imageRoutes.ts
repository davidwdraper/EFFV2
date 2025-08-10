// backend/services/image/src/routes/imageRoutes.ts
import express from "express";
import multer, { MulterError } from "multer";
import {
  postLookup,
  getImageData,
  getImageMeta,
  postUpload,
  postFinalize,
  postUnlink,
  postDiscard,
} from "../controllers/imageController";

const router = express.Router();
const OID = ":id([a-fA-F0-9]{24})";

// Multer: 8 MB cap, allow jpeg/png/webp only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  // Let TS infer cb type; reject with cb(null, false) to avoid the Error/null union drama
  fileFilter(req, file, cb) {
    const ok = /^(image\/jpeg|image\/png|image\/webp)$/.test(
      file.mimetype ?? ""
    );
    if (ok) return cb(null, true);
    (req as any).fileValidationError =
      "Unsupported file type (jpeg/png/webp only)";
    return cb(null, false);
  },
});

// Map Multer outcomes to sane HTTP
const withMulter =
  (handler: express.RequestHandler) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large (max 8MB)" });
        }
        return res.status(400).json({ error: err?.message || "Bad upload" });
      }
      if (!req.file) {
        return res.status(400).json({
          error: (req as any).fileValidationError || "No file uploaded",
        });
      }
      return handler(req, res, next);
    });

// ---- Static first (so :id can't swallow it)
router.get("/images/ping", (_req, res) =>
  res.json({ ok: true, scope: "image-svc" })
);

// ---- Reads (lookup before :id)
router.post("/images/lookup", postLookup);
router.get(`/images/${OID}/data`, getImageData);
router.get(`/images/${OID}`, getImageMeta);

// ---- Writes
router.post("/image", withMulter(postUpload)); // SINGULAR upload
router.post("/images/finalize", postFinalize);
router.post("/images/unlink", postUnlink);
router.post("/images/discard", postDiscard);

export default router;
