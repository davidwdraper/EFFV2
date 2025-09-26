// backend/services/svcconfig/src/routes/svcconfig.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR: docs/adr/0032-route-policy-via-svcconfig.md (generated via 0032-adr.sh)
 *
 * Notes:
 * - Collection routes come before param routes (no collisions).
 * - All routes are one-liners that import handlers directly.
 */

import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@eff/shared/utils/cache";

import { ping } from "../controllers/svcconfig/handlers/ping";
import { list } from "../controllers/svcconfig/handlers/list";
import { read } from "../controllers/svcconfig/handlers/read";
import { create } from "../controllers/svcconfig/handlers/create";
import { patch } from "../controllers/svcconfig/handlers/patch";
import { remove } from "../controllers/svcconfig/handlers/remove";
import { broadcast } from "../controllers/svcconfig/handlers/broadcast";

const router = Router();

router.get("/ping", ping);

// collections first
router.get("/services", cacheGet("svcconfig", "SVCCONFIG_CACHE_TTL_SEC"), list);

// root collection (kept for backward-compat)
router.get("/", cacheGet("svcconfig", "SVCCONFIG_CACHE_TTL_SEC"), list);

// item by slug (optional ?version=INT) → returns baseUrl + merged policy
router.get("/:slug", cacheGet("svcconfig", "SVCCONFIG_CACHE_TTL_SEC"), read);

// mutations
router.put("/", invalidateOnSuccess("svcconfig")(create));
router.patch("/:slug", invalidateOnSuccess("svcconfig")(patch));
router.delete("/:slug", invalidateOnSuccess("svcconfig")(remove));

router.post("/broadcast", invalidateOnSuccess("svcconfig")(broadcast));

export default router;
