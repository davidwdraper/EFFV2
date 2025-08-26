// backend/services/user/src/routes/directoryRoutes.ts
import { Router } from "express";
import * as c from "../controllers/directoryController";
import { cacheGet } from "../../../shared/utils/cache";

const r = Router();

// Directory lookups are read-only; safe to cache under a separate namespace
r.get("/search", cacheGet("user-directory", "USER_CACHE_TTL_SEC"), c.search);

export default r;
