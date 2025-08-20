// backend/services/user/src/routes/directoryRoutes.ts
import { Router } from "express";
import { cacheGet } from "../../../shared/utils/cache";
import * as C from "../controllers/directoryController";

const r = Router();

// Cache is fine here; it’s public GET and read-mostly
r.get(
  "/search",
  cacheGet("user-directory", "USER_DIRECTORY_CACHE_TTL_SEC"),
  C.search
);

export default r;
