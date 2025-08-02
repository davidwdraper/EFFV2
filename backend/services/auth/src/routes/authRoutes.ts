// src/routes/authRoutes.ts
import express from "express";
import { signup, login } from "../controllers/authController";
import { logger } from "@shared/utils/logger";

const router = express.Router();

logger.debug("authService: authRoutes initialized", {
  routes: ["/auth/signup", "/auth/login"],
});

router.post("/signup", signup);
router.post("/login", login);

export default router;
