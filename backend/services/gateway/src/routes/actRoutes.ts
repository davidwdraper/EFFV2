// backend/services/gateway/src/routes/actRoutes.ts
import { Router } from "express";
import * as C from "../controllers/actProxyController";

const r = Router();

// One-liners only; preserve paths exactly as the Act service exposes them
r.get("/", C.list); // GET /acts
r.get("/:id", C.getById); // GET /acts/:id
r.post("/", C.create); // POST /acts
r.put("/:id", C.update); // PUT /acts/:id
r.delete("/:id", C.remove); // DELETE /acts/:id

export default r;
