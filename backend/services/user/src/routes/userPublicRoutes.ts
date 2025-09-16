// backend/services/user/src/routes/userPublicRoutes.ts
import { Router } from "express";
import { cacheGet } from "@eff/shared/src/utils/cache";
import { publicNames } from "../controllers/user.public.controller";

const router = Router();

// Final path: GET /api/user/public/names?ids=...
// Cache is fine here; TTL via USER_CACHE_TTL_SEC
router.get(
  "/public/names",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  publicNames
);

export default router;
