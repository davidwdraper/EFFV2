import { Router } from "express";
import multer from "multer";
import {
  getImageMeta,
  getImageData,
  postLookup,
  postUpload,
  postFinalize,
  postUnlink,
  postDiscard,
} from "../controllers/imageController";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}); // 15MB

// NOTE: Mount upstream auth before these routes in app.ts for mutating endpoints.
// e.g., app.use("/images", authenticate, imageRoutes) for POSTs if you want global protection.

// READ
router.get("/:id", getImageMeta);
router.get("/:id/data", getImageData);
router.post("/lookup", postLookup);

// WRITE (require auth upstream)
router.post("/", upload.single("file"), postUpload);
router.post("/finalize", postFinalize);
router.post("/unlink", postUnlink);
router.post("/discard", postDiscard);

export default router;
