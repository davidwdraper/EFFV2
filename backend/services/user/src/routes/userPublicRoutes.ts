// backend/services/user/src/routes/userPublicRoutes.ts
import { Router } from "express";
import * as c from "../controllers/userPublicController";

const router = Router();

// One-liner route mapping → controller (no logic here)
router.get("/public/names", c.publicNames);

export default router;
