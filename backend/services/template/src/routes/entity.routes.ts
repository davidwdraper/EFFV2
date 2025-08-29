// backend/services/template/src/routes/entity.routes.ts
import { Router } from "express";
import { cacheGet, invalidateOnSuccess } from "@shared/utils/cache";
import { create } from "../controllers/entity/handlers/create";
// For a real service, add: list/findById/update/remove handlers

const router = Router();

router.get("/ping", (_req, res) => res.json({ ok: true }));

// Reads with cache
router.get("/", cacheGet("entity", "ENTITY_CACHE_TTL_SEC"), (_req, res) =>
  res.json({ items: [] })
);

// Mutations invalidate cache
router.post("/", invalidateOnSuccess("entity")(create));

export default router;
