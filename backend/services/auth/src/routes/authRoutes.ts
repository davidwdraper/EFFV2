// backend/services/auth/src/routes/authRoutes.ts
/**
 * Docs:
 * - Arch: docs/architecture/shared/ROUTE_CONVENTIONS.md
 * - SOP:  docs/architecture/backend/SOP.md
 *
 * Why:
 * - Route one-liners only. Service mounts under /api; gateway adds slug.
 *   External (via gateway):  /api/auth/<...>
 *   Internal (service):      /api/auth/<...>
 */

import { Router } from "express";

// direct handler imports (no barrels/shims)
import create from "../handlers/auth/create";
import login from "../handlers/auth/login";
import passwordReset from "../handlers/auth/passwordReset";

const router = Router();

router.post("/create", create);
router.post("/login", login);
router.post("/password_reset", passwordReset);

export default router;
