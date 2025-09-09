// backend/services/audit/src/routes/health.routes.ts
/**
 * Docs:
 * - Arch: docs/architecture/shared/ROUTE_CONVENTIONS.md
 *
 * Why:
 * - Health routes live OUTSIDE /api and must not require S2S.
 * - Mount this FIRST in the app.
 */
import { Router } from "express";
import ready from "../handlers/health/ready";
// If your ping handler already exists at this path, great. If not, drop this minimal one:
// export default (_req,res)=>res.status(200).json({ok:true})
import { ping } from "../handlers/health/ping";

const router = Router();
router.get("/healthz", ping);
router.get("/readyz", ready);
export default router;
