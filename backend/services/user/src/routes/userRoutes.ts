// backend/services/user/src/routes/userRoutes.ts
import { Router } from "express";
import { authenticate } from "@shared/middleware/authenticate";
import * as c from "../controllers/userController";
import { cacheGet, invalidateOnSuccess } from "../../../shared/utils/cache";

const r = Router();

// PUBLIC
r.post("/", invalidateOnSuccess("user"), c.create); // signup (no JWT)
r.get("/", cacheGet("user", "USER_CACHE_TTL_SEC"), c.list); // list users (public for now)
r.get(
  "/email/:email",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  c.getUserByEmail
); // user by email (no password)
r.get(
  "/private/email/:email",
  cacheGet("user", "USER_CACHE_TTL_SEC"),
  c.getUserByEmailWithPassword
); // internal (hash included)
r.get("/:id", cacheGet("user", "USER_CACHE_TTL_SEC"), c.getById); // user by id

// PROTECTED
r.put("/:id", authenticate, invalidateOnSuccess("user"), c.update); // update user
r.delete("/:id", authenticate, invalidateOnSuccess("user"), c.remove); // delete user

export default r;
