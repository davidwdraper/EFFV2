// backend/services/act/src/routes/townRoutes.ts
import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@shared/utils/cache";

// Direct handler imports (no barrels, no adapters)
import { ping } from "../controllers/town/handlers/ping";
import { list } from "../controllers/town/handlers/list";
import { findById } from "../controllers/town/handlers/findById";
import { typeahead } from "../controllers/town/handlers/typeahead";

const router = Router();

// one-liners only — no logic here
router.get("/ping", ping);

// Public GETs with cache (TTL via TOWN_CACHE_TTL_SEC)
router.get("/search", cacheGet("town", "TOWN_CACHE_TTL_SEC"), typeahead);
router.get("/", cacheGet("town", "TOWN_CACHE_TTL_SEC"), list);
router.get("/:id", cacheGet("town", "TOWN_CACHE_TTL_SEC"), findById);

// If you later add create/update/remove, wrap them with invalidateOnSuccess("town")

export default router;
