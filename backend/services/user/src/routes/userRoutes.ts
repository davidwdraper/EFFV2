// backend/services/user/src/routes/userRoutes.ts
import { Router } from "express";
import { authenticate } from "@shared/middleware/authenticate";
import * as c from "../controllers/userController";
import { cacheGet, invalidateOnSuccess } from "@shared/utils/cache";

const r = Router();

// PUBLIC
r.post("/", invalidateOnSuccess("user")(c.create));
r.get("/", cacheGet("user", "USER_CACHE_TTL_SEC"), c.list);
r.get(
  "/email/:email",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  c.getUserByEmail
);
r.get(
  "/private/email/:email",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  c.getUserByEmailWithPassword
);
r.get("/:id", cacheGet("user", "USER_CACHE_TTL_SEC"), c.getById);

// PROTECTED — semantics: PUT = replace, PATCH = partial update
r.put("/:id", authenticate, invalidateOnSuccess("user")(c.replaceUser));
r.patch("/:id", authenticate, invalidateOnSuccess("user")(c.patchUser));
r.delete("/:id", authenticate, invalidateOnSuccess("user")(c.remove));

export default r;
