// backend/services/gateway/src/routes/imageRoutes.ts
import { Router } from "express";
import { proxyImages } from "../controllers/imageProxyController";

const router = Router();

// One-liner mount; all /images/** proxied to IMAGE_SERVICE_URL as-is
router.use("/", proxyImages);

export default router;
