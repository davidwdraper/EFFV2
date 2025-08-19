// backend/services/auth/src/controllers/authController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import axios, { AxiosError } from "axios";
import { generateToken } from "../utils/jwtUtils";
import { logger } from "@shared/utils/logger";
import { config } from "../config";

// Direct to User service (tier-3)
const USER_SERVICE_URL = config.userServiceUrl.replace(/\/$/, "");

// Helper to pass through upstream errors cleanly
function passThroughError(res: Response, err: unknown, fallback: string) {
  const ax = err as AxiosError;
  if (ax?.response) {
    const { status, data } = ax.response;
    return res.status(status).send(data);
  }
  const code = ax?.code || "";
  const msg = (ax as any)?.message || "Upstream error";
  const timeout =
    code === "ECONNABORTED" ||
    (typeof (ax as any)?.message === "string" &&
      (ax as any).message.toLowerCase().includes("timeout"));
  const connErr =
    code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH";
  const status = timeout ? 504 : connErr ? 502 : 500;
  return res.status(status).json({ error: fallback, detail: msg, code });
}

/**
 * POST /auth/create
 * Body: { email, password, firstname, lastname, middlename? }
 * Behavior: hash password, create user via User service, return JWT.
 */
export const create = async (req: Request, res: Response) => {
  logger.debug(
    { bodyKeys: Object.keys(req.body || {}) },
    "authService: POST /auth/create called"
  );

  try {
    // Accept new `email` (canonical). Tolerate legacy `eMailAddr` just in case.
    const email = String((req.body.email ?? req.body.eMailAddr) || "")
      .trim()
      .toLowerCase();
    const firstname = String(req.body.firstname || "").trim();
    const middlename = String(req.body.middlename || "").trim();
    const lastname = String(req.body.lastname || "").trim();
    const password = req.body.password;

    if (!email || !password || !firstname || !lastname) {
      logger.debug(
        {
          email: !!email,
          password: !!password,
          firstname: !!firstname,
          lastname: !!lastname,
        },
        "authService: Missing required fields"
      );
      return res.status(400).json({ error: "Missing required fields" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const url = `${USER_SERVICE_URL}/users`;
    const response = await axios.post(
      url,
      { email, password: hashedPassword, firstname, middlename, lastname },
      {
        validateStatus: () => true,
        headers: {
          "content-type": "application/json",
          "x-request-id":
            (req as any).id || String(req.headers["x-request-id"] || ""),
        },
      }
    );

    // Pass through non-2xx (e.g., 409 conflict)
    if (response.status < 200 || response.status >= 300) {
      logger.error(
        { status: response.status, data: response.data },
        "authService: Create failed (downstream)"
      );
      return res.status(response.status).send(response.data);
    }

    const created = response.data?.user ?? response.data ?? {};
    const safeUser = (() => {
      const { password: _pw, eMailAddr: _legacy, ...rest } = created;
      if (!rest.email && typeof _legacy === "string")
        (rest as any).email = _legacy;
      return rest;
    })();

    const token = generateToken({
      id: String(safeUser.id ?? safeUser._id ?? safeUser.userId ?? ""),
      email: String(safeUser.email ?? email).toLowerCase(),
      firstname,
      middlename: middlename || undefined,
      lastname,
    });

    // Audit
    req.audit?.push({ type: "create", model: "Auth", userEmail: email });

    return res.status(201).json({ token, user: safeUser });
  } catch (err) {
    return passThroughError(res, err, "Signup failed");
  }
};

/**
 * POST /auth/login
 * Body: { email, password }   (legacy: accepts eMailAddr)
 * Behavior: fetch user with hash via User service, compare, return JWT.
 */
export const login = async (req: Request, res: Response) => {
  logger.debug(
    { bodyKeys: Object.keys(req.body || {}) },
    "authService: POST /auth/login called"
  );

  try {
    const email = String((req.body.email ?? req.body.eMailAddr) || "")
      .trim()
      .toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      logger.debug({}, "authService: Missing email or password");
      return res.status(400).json({ error: "Missing email or password" });
    }

    const url = `${USER_SERVICE_URL}/users/private/email/${encodeURIComponent(
      email
    )}`;
    const response = await axios.get(url, {
      validateStatus: () => true,
      headers: {
        "x-request-id":
          (req as any).id || String(req.headers["x-request-id"] || ""),
      },
    });

    // Treat 404 as invalid creds
    if (response.status === 404) {
      logger.debug({}, "authService: User not found (mapping 404→401)");
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (response.status < 200 || response.status >= 300) {
      logger.error(
        { status: response.status, data: response.data },
        "authService: Login failed (downstream)"
      );
      return res.status(response.status).send(response.data);
    }

    const user = response.data?.user ?? response.data;
    const hash: string | undefined = user?.password;
    if (!hash) {
      logger.debug({}, "authService: User missing password hash");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(String(password), String(hash));
    if (!ok) {
      logger.debug({}, "authService: Password mismatch");
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateToken({
      id: String(user.id ?? user._id ?? user.userId ?? ""),
      email: String(user.email ?? email).toLowerCase(),
      firstname: String(user.firstname || "").trim(),
      middlename: String(user.middlename || "").trim() || undefined,
      lastname: String(user.lastname || "").trim(),
    });

    // Audit (no password!)
    req.audit?.push({ type: "login", model: "Auth", userEmail: email });

    return res.status(200).json({
      token,
      user: {
        id: String(user.id ?? user._id ?? user.userId ?? ""),
        email: String(user.email ?? email).toLowerCase(),
        firstname: user.firstname,
        middlename: user.middlename,
        lastname: user.lastname,
      },
    });
  } catch (err) {
    return passThroughError(res, err, "Login failed");
  }
};

/**
 * POST /auth/password_reset
 * Body: { email, newPassword }
 * Behavior: look up user id via private email, PUT new password to user service.
 */
export const passwordReset = async (req: Request, res: Response) => {
  logger.debug({}, "authService: POST /auth/password_reset called");

  try {
    const email = String((req.body.email ?? req.body.eMailAddr) || "")
      .trim()
      .toLowerCase();
    const newPassword = req.body.newPassword;

    if (!email || !newPassword) {
      return res.status(400).json({ error: "email and newPassword required" });
    }

    // Get user (with hash) to obtain canonical id
    const lookupUrl = `${USER_SERVICE_URL}/users/private/email/${encodeURIComponent(
      email
    )}`;
    const lookup = await axios.get(lookupUrl, {
      validateStatus: () => true,
      headers: {
        "x-request-id":
          (req as any).id || String(req.headers["x-request-id"] || ""),
      },
    });

    if (lookup.status === 404)
      return res.status(404).json({ error: "User not found" });
    if (lookup.status < 200 || lookup.status >= 300) {
      return res.status(lookup.status).send(lookup.data);
    }

    const user = lookup.data?.user ?? lookup.data;
    const id = String(user.id ?? user._id ?? user.userId ?? "");
    if (!id) return res.status(404).json({ error: "User not found" });

    // Hash new password in Auth (consistent with /create)
    const newHash = await bcrypt.hash(String(newPassword), 10);

    const updateUrl = `${USER_SERVICE_URL}/users/${encodeURIComponent(id)}`;
    const update = await axios.put(
      updateUrl,
      { password: newHash, dateLastUpdated: new Date().toISOString() },
      {
        validateStatus: () => true,
        headers: {
          "content-type": "application/json",
          "x-request-id":
            (req as any).id || String(req.headers["x-request-id"] || ""),
        },
      }
    );

    if (update.status < 200 || update.status >= 300) {
      logger.error(
        { status: update.status, data: update.data },
        "authService: password_reset downstream error"
      );
      return res.status(update.status).send(update.data);
    }

    // Audit
    req.audit?.push({
      type: "password_reset",
      model: "Auth",
      userEmail: email,
    });

    return res.json({ ok: true });
  } catch (err) {
    return passThroughError(res, err, "Password reset failed");
  }
};
