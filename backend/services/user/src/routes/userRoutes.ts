// src/routes/userRoutes.ts
import express from "express";
import { UserModel } from "../models/User";
import { authenticate } from "@shared/middleware/authenticate";
import { logger } from "@shared/utils/logger";
import {
  getUserByEmail,
  getUserByEmailWithPassword,
} from "../controllers/userController";

const router = express.Router();

/**
 * PUBLIC: Create user (signup)
 * Used by authService via orch-core. No JWT expected.
 */
router.post("/", async (req, res) => {
  logger.debug("userService: POST /users called");
  try {
    const { eMailAddr, password, firstname, lastname, middlename } = req.body;

    if (!eMailAddr || !password || !firstname || !lastname) {
      logger.debug("userService: POST /users missing required fields", {
        eMailAddr: !!eMailAddr,
        password: !!password,
        firstname: !!firstname,
        lastname: !!lastname,
      });
      return res.status(400).json({ error: "Missing required user fields" });
    }

    const existing = await UserModel.findOne({ eMailAddr });
    if (existing) {
      logger.debug("userService: User already exists", { eMailAddr });
      return res.status(409).json({ error: "User already exists" });
    }

    const now = new Date();
    const newUser = new UserModel({
      eMailAddr,
      password,
      firstname,
      lastname,
      middlename,
      dateCreated: now,
      dateLastUpdated: now,
      userStatus: 0,
      userType: 0,
      imageIds: [],
    });

    await newUser.save();

    logger.info("userService: New user created", { userId: newUser._id });

    // Do NOT return password or hash
    res.status(201).json({
      userId: newUser._id,
      eMailAddr: newUser.eMailAddr,
      firstname: newUser.firstname,
      middlename: newUser.middlename,
      lastname: newUser.lastname,
    });
  } catch (err: any) {
    logger.error("userService: POST /users failed", { error: err.message });
    res.status(500).json({ error: "Failed to create user" });
  }
});

/**
 * PUBLIC: Internal login helper (no JWT)
 * Returns user with password hash — used ONLY by authService via orch-core.
 */
router.get("/private/email/:eMailAddr", getUserByEmailWithPassword);

/**
 * PUBLIC: Get user by email (no password)
 */
router.get("/email/:eMailAddr", getUserByEmail);

/**
 * PUBLIC: Get all users
 */
router.get("/", async (_req, res) => {
  logger.debug("userService: GET /users - Fetching all users");
  try {
    const users = await UserModel.find();
    res.status(200).json(users);
  } catch (err: any) {
    logger.error("userService: GET /users failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUBLIC: Get user by ID
 */
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

/**
 * PROTECTED: Update user by ID (JWT required)
 */
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

/**
 * PROTECTED: Delete user by ID (JWT required)
 */
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
