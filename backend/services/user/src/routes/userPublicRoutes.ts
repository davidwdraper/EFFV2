// backend/services/user/src/routes/userPublicRoutes.ts
import { Router } from "express";
import * as c from "../controllers/userPublicController";
import { cacheGet } from "../../../shared/utils/cache";

const r = Router();

// Cache is fine here; TTL via USER_CACHE_TTL_SEC
r.get("/public/names", cacheGet("user", "USER_CACHE_TTL_SEC"), c.publicNames);

export default r;
