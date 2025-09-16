// backend/services/act/src/routes/townRoutes.ts
import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@eff/shared/src/utils/cache";

// Direct handler imports (no barrels, no adapters)
import { list } from "../handlers/town/list";
import { findById } from "../handlers/town/findById";
import { typeahead } from "../handlers/town/typeahead";

const router = Router();

// Public GETs with cache (TTL via TOWN_CACHE_TTL_SEC)
router.get("/search", cacheGet("town", "TOWN_CACHE_TTL_SEC"), typeahead);
router.get("/", cacheGet("town", "TOWN_CACHE_TTL_SEC"), list);
router.get("/:id", cacheGet("town", "TOWN_CACHE_TTL_SEC"), findById);

// If you later add create/update/remove, wrap them with invalidateOnSuccess("town")

export default router;
