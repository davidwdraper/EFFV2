// src/controllers/authController.ts
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import bcrypt from "bcrypt";
import { config } from "../config";
import { AuthPayload } from "../types/AuthPayload";
import { logger } from "@shared/utils/logger";

export const signup = async (req: Request, res: Response) => {
  logger.debug("[AuthService] Signup attempt", { body: req.body });

  try {
    const response = await axios.post(
      `${config.orchestratorUrl}/Users`,
      req.body
    );
    logger.debug("[AuthService] Signup success", { user: response.data });
    res.status(response.status).json(response.data);
  } catch (err: any) {
    logger.error("[AuthService] Signup error via orchestrator", {
      error: err.message,
      responseData: err.response?.data,
      status: err.response?.status,
    });

    const status = err.response?.status || 500;
    const message = err.response?.data?.error || "Signup failed";
    res.status(status).json({ error: message });
  }
};

export const login = async (req: Request, res: Response) => {
  const { eMailAddr, password } = req.body;
  logger.debug("[AuthService] Login attempt", { eMailAddr });

  try {
    const response = await axios.get(
      `${config.orchestratorUrl}/Users/byEmail/${eMailAddr}`
    );
    const user = response.data;

    if (!user?.password) {
      logger.debug("[AuthService] Login failed: missing password");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.debug("[AuthService] Login failed: password mismatch");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const payload: AuthPayload = {
      _id: user._id,
      userType: user.userType,
      firstname: user.firstname,
      lastname: user.lastname,
      eMailAddr: user.eMailAddr,
    };

    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: "24h" });
    logger.debug("[AuthService] Login success", { userId: user._id });

    res.json({ token });
  } catch (err: any) {
    logger.error("[AuthService] Login error", {
      error: err.message,
      stack: err.stack,
    });

    return res.status(401).json({ error: "Invalid credentials" });
  }
};
