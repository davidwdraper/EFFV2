// backend/services/user/src/routes/userPublicRoutes.ts
import { Router } from "express";
import * as c from "../controllers/userPublicController";
import { cacheGet } from "../../../shared/utils/cache";

const router = Router();

// Public names lookup (IDs → "First [Middle] Last"); cached by TTL env
router.get(
  "/public/names",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  c.publicNames
);

export default router;
