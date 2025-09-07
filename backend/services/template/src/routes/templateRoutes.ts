// backend/services/template/src/routes/templateroutes.ts
import { Router } from "express";

// Direct handler imports (no barrels)
import { ping } from "../controllers/template/handlers/ping";
import { list } from "../controllers/template/handlers/list";
import { findById } from "../controllers/template/handlers/findById";
import { create } from "../controllers/template/handlers/create";
import { update } from "../controllers/template/handlers/update";
import { remove } from "../controllers/template/handlers/remove";

const router = Router();

// Optional service-level ping (kept under /api)
router.get("/ping", ping);

// CRUD: Create = PUT to collection root
router.put("/", create);
router.get("/", list);
router.get("/:id", findById);
router.patch("/:id", update);
router.delete("/:id", remove);

export default router;
