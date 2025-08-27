// backend/services/act/src/routes/actRoutes.ts
import { Router } from "express";
import * as ActController from "../controllers/actController";
import { cacheGet, invalidateOnSuccess } from "@shared/utils/cache";

const router = Router();

// one-liners only — no logic here
router.get("/ping", ActController.ping);

// Public GETs with cache (TTL via ACT_CACHE_TTL_SEC)
router.get(
  "/search",
  cacheGet("act", "ACT_CACHE_TTL_SEC"),
  ActController.search
);
router.get(
  "/by-hometown",
  cacheGet("act", "ACT_CACHE_TTL_SEC"),
  ActController.byHometown
);
router.get("/", cacheGet("act", "ACT_CACHE_TTL_SEC"), ActController.list);
router.get("/:id", cacheGet("act", "ACT_CACHE_TTL_SEC"), ActController.getById);

// Mutations invalidate the "act" namespace on success
router.post("/", invalidateOnSuccess("act")(ActController.create));
router.patch("/:id", invalidateOnSuccess("act")(ActController.update));
router.put("/:id", invalidateOnSuccess("act")(ActController.update));
router.delete("/:id", invalidateOnSuccess("act")(ActController.remove));

export default router;
