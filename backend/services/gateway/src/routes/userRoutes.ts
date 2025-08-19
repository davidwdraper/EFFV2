// backend/services/gateway/src/routes/userRoutes.ts
import { Router } from "express";
import * as C from "../controllers/userProxyController";

const r = Router();

r.post("/", C.create);
r.get("/private/email/:email", C.getByEmail);

export default r;
