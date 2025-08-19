// backend/services/user/src/routes/userRoutes.ts
import { Router } from "express";
import { authenticate } from "@shared/middleware/authenticate";
import * as c from "../controllers/userController";

const r = Router();

// PUBLIC
r.post("/", c.create); // signup (no JWT)
r.get("/", c.list); // list users (public for now)
r.get("/email/:email", c.getUserByEmail); // user by email (no password)
r.get("/private/email/:email", c.getUserByEmailWithPassword); // internal (hash included)
r.get("/:id", c.getById); // user by id

// PROTECTED
r.put("/:id", authenticate, c.update); // update user
r.delete("/:id", authenticate, c.remove); // delete user

export default r;
