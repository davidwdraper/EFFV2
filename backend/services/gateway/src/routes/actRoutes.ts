// backend/services/gateway/src/routes/actRoutes.ts
import { Router } from "express";
import * as C from "../controllers/actProxyController";
import { authGate } from "../middleware/authGate";

const r = Router();

// Health (proxied)
r.get("/ping", C.ping);

// Specific routes MUST be before :id
r.get("/search", C.search); // GET /acts/search?lat=&lng=&miles=&q=&limit=
r.get("/by-hometown", C.byHometown); // GET /acts/by-hometown?lat=&lng=&miles=&limit=

// Read-only (public by default)
r.get("/", C.list); // GET /acts
r.get("/:id", C.getById); // GET /acts/:id

// Mutations require auth
r.post("/", authGate(), C.create); // POST /acts
r.put("/:id", authGate(), C.update); // PUT /acts/:id
r.patch("/:id", authGate(), C.patch); // PATCH /acts/:id
r.delete("/:id", authGate(), C.remove); // DELETE /acts/:id

export default r;
