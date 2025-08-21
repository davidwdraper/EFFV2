// backend/services/gateway/src/routes/townRoutes.ts
import { Router } from "express";
import * as c from "../controllers/townProxyController";

const r = Router();

r.get("/typeahead", c.typeahead); // alias expected by Flutter page
r.get("/", c.list);
r.get("/:id", c.getById);

export default r;
