// backend/services/image/src/routes/imageRoutes.ts
import express from "express";
import multer from "multer";
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
const upload = multer({ storage: multer.memoryStorage() });

// ---- Static first (so :id can't swallow it)
router.get("/images/ping", (_req, res) =>
  res.json({ ok: true, scope: "image-svc" })
);
// optional extra ping
router.get("/ping", (_req, res) => res.json({ ok: true, scope: "image-svc" }));

// ---- Reads (lookup before :id)
router.post("/images/lookup", postLookup);
router.get("/images/:id([a-fA-F0-9]{24})/data", getImageData);
router.get("/images/:id([a-fA-F0-9]{24})", getImageMeta);

// ---- Writes
router.post("/image", upload.single("file"), postUpload); // SINGULAR
router.post("/images/finalize", postFinalize);
router.post("/images/unlink", postUnlink);
router.post("/images/discard", postDiscard);

export default router;
