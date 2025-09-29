// backend/services/image/src/routes/imageRoutes.ts
import { Router } from "express";
import * as controller from "../controllers/imageController";
import { uploadMiddleware } from "../middleware/upload";

const router = Router();
const OID = ":id([a-fA-F0-9]{24})";

// NOTE: mount at app.use("/images", router) in app.ts
router.get("/ping", controller.ping);
router.post("/lookup", controller.postLookup);
router.get(`/${OID}/data`, controller.getImageData);
router.get(`/${OID}`, controller.getImageMeta);
router.post("/", uploadMiddleware.single("file"), controller.postUpload);
router.post("/finalize", controller.postFinalize);
router.post("/unlink", controller.postUnlink);
router.post("/discard", controller.postDiscard);

export default router;
