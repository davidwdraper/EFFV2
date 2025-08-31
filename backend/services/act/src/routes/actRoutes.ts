// backend/services/act/src/routes/actRoutes.ts
import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@shared/utils/cache";

// 🔧 Direct handler imports (no barrels, no adapters)
import { ping } from "../controllers/act/handlers/ping";
import { search, byHometown } from "../controllers/act/handlers/search";
import { list } from "../controllers/act/handlers/list";
import { findById } from "../controllers/act/handlers/findById";
import { create } from "../controllers/act/handlers/create";
import { update } from "../controllers/act/handlers/update";
import { remove } from "../controllers/act/handlers/remove";

const router = Router();

// one-liners only — no logic here
router.get("/ping", ping);

// Public GETs with cache (TTL via ACT_CACHE_TTL_SEC)
router.get("/search", cacheGet("act", "ACT_CACHE_TTL_SEC"), search);
router.get("/by-hometown", cacheGet("act", "ACT_CACHE_TTL_SEC"), byHometown);
router.get("/", cacheGet("act", "ACT_CACHE_TTL_SEC"), list);
router.get("/:id", cacheGet("act", "ACT_CACHE_TTL_SEC"), findById);

// Mutations invalidate the "act" namespace on success
router.post("/", invalidateOnSuccess("act")(create));
// NEW: support root PUT as upsert (aligns with smoke tests #7/#8/#10)
router.put("/", invalidateOnSuccess("act")(create));
router.patch("/:id", invalidateOnSuccess("act")(update));
router.put("/:id", invalidateOnSuccess("act")(update));
router.delete("/:id", invalidateOnSuccess("act")(remove));

export default router;
