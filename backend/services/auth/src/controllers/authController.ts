// src/controllers/authController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import axios, { AxiosError } from "axios";
import { generateToken } from "../utils/jwtUtils";
import { logger } from "@shared/utils/logger";

const ORCHESTRATOR_CORE_URL =
  process.env.ORCHESTRATOR_CORE_URL || "http://localhost:4011";

export const signup = async (req: Request, res: Response) => {
  logger.debug("authService: POST /signup called");

  try {
    const eMailAddr = (req.body.eMailAddr || "").trim();
    const firstname = (req.body.firstname || "").trim();
    const middlename = (req.body.middlename || "").trim();
    const lastname = (req.body.lastname || "").trim();
    const password = req.body.password;

    if (!eMailAddr || !password || !firstname || !middlename || !lastname) {
      logger.debug("authService: Missing required fields", {
        eMailAddr: !!eMailAddr,
        password: !!password,
        firstname: !!firstname,
        middlename: !!middlename,
        lastname: !!lastname,
      });
      return res.status(400).json({ error: "Missing required fields" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const path = `${ORCHESTRATOR_CORE_URL}/users`;
    logger.debug("authService: calling orch-core to create user", {
      url: path,
    });

    const response = await axios.post(
      path,
      { eMailAddr, password: hashedPassword, firstname, middlename, lastname },
      {
        // IMPORTANT: do not throw on 4xx/5xx so we can pass through status
        validateStatus: () => true,
        headers: {
          /* forward anything useful later if needed */
        },
      }
    );

    // Pass through any non-2xx from orch-core (e.g., 409 duplicate)
    if (response.status < 200 || response.status >= 300) {
      logger.error("authService: Signup failed (downstream)", {
        status: response.status,
        data: response.data,
      });
      return res.status(response.status).send(response.data);
    }

    const user = response.data?.user || response.data;
    const { password: _pw, ...safeUser } = user;

    logger.debug("[Auth] signup safeUser", { safeUser });
    const token = generateToken(safeUser);

    return res.status(201).json({ token, user: safeUser });
  } catch (error: any) {
    const ax = error as AxiosError;
    logger.error("authService: Signup transport error", {
      message: ax?.message,
      code: ax?.code,
    });

    // Transport-level errors only (no response)
    const code = ax?.code || "";
    const isTimeout =
      code === "ECONNABORTED" ||
      (typeof ax?.message === "string" &&
        ax.message.toLowerCase().includes("timeout"));
    const isConn =
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "EHOSTUNREACH";

    const status = isTimeout ? 504 : isConn ? 502 : 500;
    return res.status(status).json({
      error: "Signup failed",
      detail: ax?.message || "Upstream error",
      code,
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
      logger.debug("authService: Missing eMailAddr or password");
      return res.status(400).json({ error: "Missing eMailAddr or password" });
    }

    const url = `${ORCHESTRATOR_CORE_URL}/users/private/email/${encodeURIComponent(
      eMailAddr
    )}`;
    logger.debug("authService: Fetching user from orchestrator-core", { url });

    const response = await axios.get(url, {
      validateStatus: () => true, // don't throw on 404 etc.
      headers: {
        /* pass through headers if needed */
      },
    });

    // Treat 404 as invalid credentials (common auth UX)
    if (response.status === 404) {
      logger.debug("authService: User not found (mapping 404→401)");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Other non-2xx from downstream → pass through as-is
    if (response.status < 200 || response.status >= 300) {
      logger.error("authService: Login failed (downstream)", {
        status: response.status,
        data: response.data,
      });
      return res.status(response.status).send(response.data);
    }

    const user = response.data?.user || response.data;

    if (!user?.password) {
      logger.debug("authService: User missing password hash");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      logger.debug("authService: Password mismatch");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const { password: _pw, ...safeUser } = user;
    const token = generateToken(safeUser);

    logger.debug("authService: User authenticated, token issued", {
      userId: user._id || user.userId,
    });

    return res.status(200).json({ token, user: safeUser });
  } catch (error: any) {
    const ax = error as AxiosError;
    logger.error("authService: Login transport error", {
      message: ax?.message,
      code: ax?.code,
    });

    const code = ax?.code || "";
    const isTimeout =
      code === "ECONNABORTED" ||
      (typeof ax?.message === "string" &&
        ax.message.toLowerCase().includes("timeout"));
    const isConn =
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "EHOSTUNREACH";

    const status = isTimeout ? 504 : isConn ? 502 : 500;
    return res.status(status).json({
      error: "Login failed",
      detail: ax?.message || "Upstream error",
      code,
    });
  }
};
