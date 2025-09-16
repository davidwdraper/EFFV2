// backend/services/user/src/routes/directoryRoutes.ts
import { Router } from "express";
import { cacheGet } from "@eff/shared/src/utils/cache";
import { search } from "../controllers/user.directory.controller";

const router = Router();

// Final path: GET /api/user/directory/search?q=...
// Directory lookups are read-only; safe to cache under a separate namespace
router.get("/search", cacheGet("user-directory", "USER_CACHE_TTL_SEC"), search);

export default router;
