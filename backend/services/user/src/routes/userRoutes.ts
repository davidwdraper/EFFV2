import express from "express";
import { UserModel } from "../models/User";
import { createAuthenticateMiddleware } from "@shared/middleware/authenticate";
import { JWT_SECRET } from "@shared/utils/env";
import { logger } from "@shared/utils/logger";
import { getUserByEmail } from "../controllers/userController";

const router = express.Router();
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔍 GET - Get user by email (used by authService only)
router.get("/email/:eMailAddr", getUserByEmail);

// 📋 GET - Get all users (public)
router.get("/", async (req, res) => {
  logger.debug("userService: GET /users - Fetching all users", {});
  try {
    const users = await UserModel.find();
    res.status(200).json(users);
  } catch (err: any) {
    logger.error("userService: GET /users failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// 📄 GET - Get user by ID (public)
router.get("/:id", async (req, res) => {
  const userId = req.params.id;
  logger.debug("userService: GET /users/:id called", { userId });

  try {
    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json(user);
  } catch (err: any) {
    logger.error("userService: GET /users/:id failed", {
      userId,
      error: err.message,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✏️ PUT - Update user by ID (protected)
router.put("/:id", authenticate, async (req, res) => {
  const userId = req.params.id;
  logger.debug("userService: PUT /users/:id called", { userId });

  try {
    const user = await UserModel.findByIdAndUpdate(userId, req.body, {
      new: true,
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json(user);
  } catch (err: any) {
    logger.error("userService: PUT /users/:id failed", {
      userId,
      error: err.message,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ❌ DELETE - Delete user by ID (protected)
router.delete("/:id", authenticate, async (req, res) => {
  const userId = req.params.id;
  logger.debug("userService: DELETE /users/:id called", { userId });

  try {
    const result = await UserModel.findByIdAndDelete(userId);
    if (!result) return res.status(404).json({ error: "User not found" });
    res.status(200).json({ success: true });
  } catch (err: any) {
    logger.error("userService: DELETE /users/:id failed", {
      userId,
      error: err.message,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
