// PATH: backend/services/auth/src/handlers/auth/login.ts
/**
 * POST /api/auth/login
 * Body: { email, password }
 * Behavior: fetch user (private email) via S2S, compare bcrypt, return JWT.
 */
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import { logger } from "@eff/shared/src/utils/logger";
import { config } from "../../config";
import { generateToken } from "../../utils/jwtUtils";

function pickPayload(resp: any) {
  return resp?.body ?? resp?.data ?? resp?.payload ?? undefined;
}

export default async function login(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[AuthHandlers.login] enter");
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const resp = await callBySlug<any>(config.userSlug, config.userApiVersion, {
      method: "GET",
      path: `${config.userRoutePrivateEmail}/${encodeURIComponent(email)}`,
      timeoutMs: 5000,
    });

    const status = Number(resp.status || 0);
    const payload = pickPayload(resp);

    if (status === 404) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!(status >= 200 && status < 300)) {
      logger.error(
        { requestId, status, data: payload },
        "[AuthHandlers.login] downstream error"
      );
      return res
        .status(status || 502)
        .send(payload ?? { error: "User lookup failed" });
    }

    // Accept either { user, password } or { user: { password } } or { password }
    const user = payload?.user ?? payload ?? {};
    const hash: string | undefined =
      (typeof payload?.password === "string" && payload.password) ||
      (typeof user?.password === "string" && user.password) ||
      undefined;

    if (!hash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, String(hash));
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const id = String(user.id ?? user._id ?? user.userId ?? "");
    const token = generateToken({
      id,
      email,
      firstname: String(user.firstname || "").trim(),
      middlename: String(user.middlename || "").trim() || undefined,
      lastname: String(user.lastname || "").trim(),
    });

    (req as any).audit?.push({
      type: "AUTH_LOGIN",
      entity: "User",
      entityId: id,
      data: { email },
    });

    logger.debug({ requestId, userId: id }, "[AuthHandlers.login] exit");
    return res.status(200).json({
      token,
      user: {
        id,
        email,
        firstname: user.firstname,
        middlename: user.middlename,
        lastname: user.lastname,
      },
    });
  } catch (err) {
    logger.debug({ requestId, err }, "[AuthHandlers.login] error");
    return next(err as Error);
  }
}
