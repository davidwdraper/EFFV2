// backend/services/svcconfig/src/routes/svcservice.routes.ts
import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@shared/utils/cache";

// 🔧 Direct handler imports (no barrels, no adapters)
import { ping } from "../controllers/svcconfig/handlers/ping";
import { list } from "../controllers/svcconfig/handlers/list";
import { read } from "../controllers/svcconfig/handlers/read";
import { create } from "../controllers/svcconfig/handlers/create";
import { patch } from "../controllers/svcconfig/handlers/patch";
import { remove } from "../controllers/svcconfig/handlers/remove";
import { broadcast } from "../controllers/svcconfig/handlers/broadcast";

const router = Router();

/**
 * Policy (matches Act/User SOP):
 * - Create = PUT /          (Mongo generates _id; slug comes from body)
 * - No POST /
 * - No PUT /:slug (replace-by-id forbidden)
 * - Update = PATCH /:slug   (partial)
 * - Delete = DELETE /:slug
 * - GETs are cacheable; mutations invalidate "svcconfig" namespace
 */

// one-liners only — no logic here
router.get("/ping", ping);

// Public GETs with cache (TTL via SVCCONFIG_CACHE_TTL_SEC)
router.get("/", cacheGet("svcconfig", "SVCCONFIG_CACHE_TTL_SEC"), list);
router.get("/:slug", cacheGet("svcconfig", "SVCCONFIG_CACHE_TTL_SEC"), read);

// Mutations invalidate the "svcconfig" namespace on success
router.put("/", invalidateOnSuccess("svcconfig")(create)); // canonical create
router.patch("/:slug", invalidateOnSuccess("svcconfig")(patch));
router.delete("/:slug", invalidateOnSuccess("svcconfig")(remove));

// Internal notify (no cache); still invalidates to be safe
router.post("/broadcast", invalidateOnSuccess("svcconfig")(broadcast));

export default router;
