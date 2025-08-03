// src/controllers/authController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import axios from "axios";
import { generateToken } from "../utils/jwtUtils";
import { logger } from "@shared/utils/logger";

const ORCHESTRATOR_CORE_URL =
  process.env.ORCHESTRATOR_CORE_URL || "http://localhost:4011";

export const signup = async (req: Request, res: Response) => {
  logger.debug("authService: POST /signup called");

  try {
    const eMailAddr = (req.body.eMailAddr || "").trim();
    const firstname = (req.body.firstname || "").trim();
    const lastname = (req.body.lastname || "").trim();
    const password = req.body.password;

    if (!eMailAddr || !password || !firstname || !lastname) {
      logger.debug("authService: Missing required fields", {
        eMailAddr: !!eMailAddr,
        password: !!password,
        firstname: !!firstname,
        lastname: !!lastname,
      });
      return res.status(400).json({ error: "Missing required fields" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const path = `${ORCHESTRATOR_CORE_URL}/users`;
    logger.debug("authService: calling orch-core to create user", {
      url: path,
    });

    const response = await axios.post(path, {
      eMailAddr,
      password: hashedPassword,
      firstname,
      lastname,
    });

    const user = response.data?.user || response.data;
    const { password: _pw, ...safeUser } = user;

    const token = generateToken(safeUser);

    res.status(201).json({ token, user: safeUser });
  } catch (error: any) {
    logger.error("authService: Signup failed", {
      error: error?.response?.data || error.message,
    });
    res.status(500).json({
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
    const eMailAddr = (req.body.eMailAddr || "").trim();
    const password = req.body.password;

    if (!eMailAddr || !password) {
      logger.debug("authService: Missing eMailAddr or password", {});
      return res.status(400).json({ error: "Missing eMailAddr or password" });
    }

    const url = `${ORCHESTRATOR_CORE_URL}/users/email/${encodeURIComponent(
      eMailAddr
    )}`;
    logger.debug("authService: Fetching user from orchestrator-core", { url });

    const response = await axios.get(url);
    const user = response.data?.user || response.data;

    if (!user?.password) {
      logger.debug("authService: User not found or missing password", {});
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      logger.debug("authService: Password mismatch", {});
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const { password: _pw, ...safeUser } = user;
    const token = generateToken(safeUser);

    logger.debug("authService: User authenticated, token issued", {
      userId: user._id || user.userId,
    });

    res.status(200).json({ token, user: safeUser });
  } catch (error: any) {
    logger.error("authService: Login failed", {
      error: error?.response?.data || error.message,
    });
    res.status(500).json({
      error: "Login failed",
      detail: error?.response?.data || error.message,
    });
  }
};
