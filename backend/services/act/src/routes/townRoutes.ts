// backend/services/act/src/routes/townRoutes.ts
import { Router } from "express";
import * as c from "../controllers/townController";
import { cacheGet } from "@shared/utils/cache";
import { methodNotAllowed } from "../middleware/methodNotAllowed";

const r = Router();

r.get("/ping", c.ping);

// Disable cache for typeahead in tests to avoid stale/poisoned results
const passthrough = (_req: any, _res: any, next: any) => next();
const maybeCacheTypeahead =
  process.env.NODE_ENV === "test"
    ? passthrough
    : cacheGet("town", "TOWN_CACHE_TTL_SEC");

// READS (existing behavior preserved)
r.get("/typeahead", maybeCacheTypeahead, c.typeahead);
r.get("/", cacheGet("town", "TOWN_CACHE_TTL_SEC"), c.list);
r.get("/:id", cacheGet("town", "TOWN_CACHE_TTL_SEC"), c.getById);

// EXPLICIT READ-ONLY CONTRACT: block mutations with 405
r.post("/", methodNotAllowed);
r.put("/:id", methodNotAllowed);
r.patch("/:id", methodNotAllowed);
r.delete("/:id", methodNotAllowed);

export default r;
