// src/controllers/authController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import axios from "axios";
import { generateToken } from "../utils/jwtUtils";
import { logger } from "@shared/utils/logger";

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL || "http://localhost:4000";

export const signup = async (req: Request, res: Response) => {
  logger.debug("authService: POST /signup called", {
    bodyKeys: Object.keys(req.body || {}),
  });

  try {
    const { eMailAddr, password } = req.body;

    if (!eMailAddr || !password) {
      logger.debug("authService: Missing eMailAddr or password", {});
      return res.status(400).json({ error: "Missing eMailAddr or password" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const response = await axios.post(`${ORCHESTRATOR_URL}/users`, {
      eMailAddr,
      password: hashedPassword,
    });

    const user = response.data?.user || response.data;

    const token = generateToken(user);

    res.status(201).json({ token, user });
  } catch (error: any) {
    logger.error("authService: Signup failed", {
      error: error?.response?.data || error.message,
    });
    res
      .status(500)
      .json({
        error: "Signup failed",
        detail: error?.response?.data || error.message,
      });
  }
};

export const login = async (req: Request, res: Response) => {
  logger.debug("authService: POST /login called", {
    bodyKeys: Object.keys(req.body || {}),
  });

  try {
    const { eMailAddr, password } = req.body;

    if (!eMailAddr || !password) {
      logger.debug("authService: Missing eMailAddr or password", {});
      return res.status(400).json({ error: "Missing eMailAddr or password" });
    }

    logger.debug("authService: Fetching user from orchestrator-core", {
      url: `${ORCHESTRATOR_URL}/users/email/${eMailAddr}`,
    });

    const response = await axios.get(
      `${ORCHESTRATOR_URL}/users/email/${eMailAddr}`
    );
    const user = response.data?.user || response.data;

    if (!user?.password) {
      logger.debug("authService: User not found or missing password field", {});
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      logger.debug("authService: Password mismatch", {});
      return res.status(401).json({ error: "Invalid email or password" });
    }

    logger.debug("authService: User authenticated, generating token", {
      userId: user.userId,
    });

    const token = generateToken(user);

    res.status(200).json({ token, user });
  } catch (error: any) {
    logger.error("authService: Login failed", {
      error: error?.response?.data || error.message,
    });
    res
      .status(500)
      .json({
        error: "Login failed",
        detail: error?.response?.data || error.message,
      });
  }
};
