// backend/services/gateway/src/routes/userRoutes.ts
import { Router } from "express";
import * as C from "../controllers/userProxyController";

const r = Router();

// Public + internal helpers
r.post("/", C.create);
r.get("/private/email/:email", C.getByEmail); // alias → getByEmailWithPassword
r.get("/email/:email", C.getByEmailPublic);
r.get("/public/names", C.publicNames);

// Common CRUD passthroughs
r.get("/", C.list);
r.get("/:id", C.getById);
r.put("/:id", C.update);
r.delete("/:id", C.remove);

export default r;
