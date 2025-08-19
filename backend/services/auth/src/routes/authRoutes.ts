// backend/services/auth/src/routes/authRoutes.ts
import express from "express";
import * as authController from "../controllers/authController";
import { logger } from "@shared/utils/logger";

const router = express.Router();

logger.debug(
  { routes: ["/auth/create", "/auth/login", "/auth/password_reset"] },
  "authService: routes initialized"
);

// One-line route → controller mappings
router.post("/create", authController.create);
router.post("/login", authController.login);
router.post("/password_reset", authController.passwordReset);

export default router;
