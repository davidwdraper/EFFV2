// backend/services/user/src/routes/userRoutes.ts
import { Router } from "express";
import { authenticate } from "@shared/middleware/authenticate";
import { cacheGet, invalidateOnSuccess } from "@shared/utils/cache";

// 🔧 Direct handler imports (no barrels)
import { create } from "../controllers/handlers/create";
import { list } from "../controllers/handlers/list";
import { getUserByEmail } from "../controllers/handlers/getUserByEmail";
import { getUserByEmailWithPassword } from "../controllers/handlers/getUserByEmailWithPassword";
import { getById } from "../controllers/handlers/getById";
import { replaceUser } from "../controllers/handlers/replaceUser";
import { patchUser } from "../controllers/handlers/patchUser";
import { remove } from "../controllers/handlers/remove";

const router = Router();

// PUBLIC
router.post("/", invalidateOnSuccess(["user", "user-directory"])(create));
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

// PROTECTED (mutations invalidate both user & directory namespaces)
router.put(
  "/:id",
  authenticate,
  invalidateOnSuccess(["user", "user-directory"])(replaceUser)
);
router.patch(
  "/:id",
  authenticate,
  invalidateOnSuccess(["user", "user-directory"])(patchUser)
);
router.delete(
  "/:id",
  authenticate,
  invalidateOnSuccess(["user", "user-directory"])(remove)
);

export default router;
