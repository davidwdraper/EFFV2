// backend/services/svcconfig/src/routes/svcconfig.routes.ts
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
 * Policy (matches Act/User SOP)
 */

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
