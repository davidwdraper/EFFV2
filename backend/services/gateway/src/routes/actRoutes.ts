// backend/services/gateway/src/routes/actRoutes.ts
import { Router } from "express";
import * as C from "../controllers/actProxyController";

const r = Router();

// Specific routes MUST be before :id
r.get("/search", C.search); // GET /acts/search?lat=&lng=&miles=&q=&limit=
r.get("/by-hometown", C.byHometown); // GET /acts/by-hometown?lat=&lng=&miles=&limit=

r.get("/", C.list); // GET /acts
r.get("/:id", C.getById); // GET /acts/:id
r.post("/", C.create); // POST /acts
r.put("/:id", C.update); // PUT /acts/:id
r.delete("/:id", C.remove); // DELETE /acts/:id

export default r;
