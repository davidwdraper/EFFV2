// backend/services/act/src/routes/actRoutes.ts
import { Router } from "express";
import * as ActController from "../controllers/actController";
import { cacheGet, invalidateOnSuccess } from "../../../shared/utils/cache";

const router = Router();

// one-liners only — no logic here
router.get("/ping", ActController.ping);

// Public GETs with cache (TTL via ACT_CACHE_TTL_SEC)
router.get("/", cacheGet("act", "ACT_CACHE_TTL_SEC"), ActController.list); // GET /acts?name=…&limit=&offset=
router.get("/:id", cacheGet("act", "ACT_CACHE_TTL_SEC"), ActController.getById); // GET /acts/:id

// Mutations invalidate the "act" namespace on success
router.post("/", invalidateOnSuccess("act"), ActController.create); // POST /acts
router.put("/:id", invalidateOnSuccess("act"), ActController.update); // PUT /acts/:id
router.delete("/:id", invalidateOnSuccess("act"), ActController.remove); // DELETE /acts/:id

export default router;
