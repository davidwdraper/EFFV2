// backend/services/user/src/routes/userRoutes.ts
import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@eff/shared/src/utils/cache";

// 🔧 Direct handler imports (no barrels)
import create from "../controllers/handlers/create";
import { list } from "../controllers/handlers/list";
import { getUserByEmail } from "../controllers/handlers/getUserByEmail";
import { getUserByEmailWithPassword } from "../controllers/handlers/getUserByEmailWithPassword";
import { getById } from "../controllers/handlers/getById";
import { patchUser } from "../controllers/handlers/patchUser";
import { remove } from "../controllers/handlers/remove";

const router = Router();

/**
 * Policy:
 * - Create = PUT / (collection root). Mongo generates _id.
 * - No POST / (back-compat removed).
 * - No PUT /:id (replace-by-id forbidden).
 * - PATCH /:id, DELETE /:id remain.
 *
 * Auth model:
 * - S2S is enforced globally in app.ts (`api.use(verifyS2S)`).
 * - End-user assertion (X-NV-User-Assertion) is applied globally to non-GETs
 *   in app.ts, gated by USER_ASSERTION_ENFORCE.
 * - Therefore, no per-route `authenticate` here.
 */

// CREATE (collection root)
router.put("/", invalidateOnSuccess(["user", "user-directory"])(create));

// LIST + READ
router.get("/", cacheGet("user", "USER_CACHE_TTL_SEC"), list);
router.get(
  "/email/:email",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  getUserByEmail
);
router.get(
  "/private/email/:email",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  getUserByEmailWithPassword
);
router.get("/:id", cacheGet("user", "USER_CACHE_TTL_SEC"), getById);

// MUTATIONS (invalidate caches)
router.patch(
  "/:id",
  invalidateOnSuccess(["user", "user-directory"])(patchUser)
);
router.delete("/:id", invalidateOnSuccess(["user", "user-directory"])(remove));

export default router;
