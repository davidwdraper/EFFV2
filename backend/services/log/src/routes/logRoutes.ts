// backend/services/log/src/routes/logRoutes.ts
import { Router } from "express";
import * as c from "../controllers/logController";
import { requireInternalToken } from "../middleware/authInternal";

const r = Router();

r.get("/ping", c.ping);
r.post("/", requireInternalToken, c.create); // one-liner, guarded

export default r;
