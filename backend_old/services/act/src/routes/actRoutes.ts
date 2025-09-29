// backend/services/act/src/routes/actRoutes.ts
import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@eff/shared/src/utils/cache";

// 🔧 Direct handler imports (no barrels, no adapters)
import { search, byHometown } from "../handlers/act/search";
import { list } from "../handlers/act/list";
import { findById } from "../handlers/act/findById";
import { create } from "../handlers/act/create";
import { update } from "../handlers/act/update";
import { remove } from "../handlers/act/remove";

const router = Router();

/**
 * Policy (matches User):
 * - Create = PUT /      (Mongo generates _id)
 * - No POST /
 * - No PUT /:id (replace-by-id forbidden)
 * - Update = PATCH /:id (partial)
 * - Delete = DELETE /:id
 * - GETs are cacheable; mutations invalidate "act" namespace
 */

// Public GETs with cache (TTL via ACT_CACHE_TTL_SEC)
router.get("/search", cacheGet("act", "ACT_CACHE_TTL_SEC"), search);
router.get("/by-hometown", cacheGet("act", "ACT_CACHE_TTL_SEC"), byHometown);
router.get("/", cacheGet("act", "ACT_CACHE_TTL_SEC"), list);
router.get("/:id", cacheGet("act", "ACT_CACHE_TTL_SEC"), findById);

// Mutations invalidate the "act" namespace on success
router.put("/", invalidateOnSuccess("act")(create)); // canonical create
router.patch("/:id", invalidateOnSuccess("act")(update));
router.delete("/:id", invalidateOnSuccess("act")(remove));

export default router;
