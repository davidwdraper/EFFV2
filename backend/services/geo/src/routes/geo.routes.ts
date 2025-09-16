// backend/services/geo/src/routes/geo.routes.ts
import { Router } from "express";
import { geoResolve } from "../handlers/geo.resolve";

const r = Router();

// one-liners only
r.post("/resolve", geoResolve);

export default r;
