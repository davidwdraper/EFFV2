// backend/services/auth/src/routes/auth.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Auth v1 router. Mount under /api/auth/v1 in app.ts.
 * - Routes here are RELATIVE (no "/v1" prefix).
 *
 * Final: Create = PUT only.
 */

import { Router } from "express";
import { AuthCreateController } from "../controllers/auth.create.controller";

// Export both named and default so app.ts can import either style.
export const authRouter = Router();

const createCtrl = new AuthCreateController();

// PUT /api/auth/v1/create
authRouter.put("/create", createCtrl.create());

export default authRouter;
