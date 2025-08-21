// backend/services/act/src/routes/townRoutes.ts
import { Router } from "express";
import * as c from "../controllers/townController";

const r = Router();

r.get("/ping", c.ping); // one-liner mount check
r.get("/typeahead", c.typeahead); // one-liner (Flutter contract you had)
r.get("/", c.list); // one-liner (gateway proxy compatibility)
r.get("/:id", c.getById); // one-liner

export default r;
