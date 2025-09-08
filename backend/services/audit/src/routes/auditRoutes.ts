// backend/services/audit/src/routes/auditroutes.ts
import { Router } from "express";

// Direct handler imports (no barrels)
import { ping } from "../controllers/audit/handlers/ping";
import { list } from "../controllers/audit/handlers/list";
import { findById } from "../controllers/audit/handlers/findById";
import { create } from "../controllers/audit/handlers/create";
import { update } from "../controllers/audit/handlers/update";
import { remove } from "../controllers/audit/handlers/remove";

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
