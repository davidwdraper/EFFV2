// backend/services/auth/src/handlers/auth/passwordReset.ts
/**
 * POST /api/auth/password_reset
 * Body: { email, newPassword }
 * Behavior: lookup user id via private email (S2S), PUT new hashed password.
 */

import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { s2sRequestBySlug } from "@eff/shared/src/utils/s2s/httpClientBySlug";
import { logger } from "@eff/shared/src/utils/logger";
import { config } from "../../config";

export default async function passwordReset(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[AuthHandlers.passwordReset] enter");
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !newPassword) {
      return res.status(400).json({ error: "email and newPassword required" });
    }

    // 1) Lookup by private email
    const lookup = await s2sRequestBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      `${config.userRoutePrivateEmail}/${encodeURIComponent(email)}`,
      { method: "GET", timeoutMs: 5000 }
    );

    if (lookup.status === 404)
      return res.status(404).json({ error: "User not found" });
    if (!lookup.ok) {
      logger.error(
        { requestId, status: lookup.status, data: lookup.data },
        "[AuthHandlers.passwordReset] lookup error"
      );
      return res
        .status(lookup.status)
        .send(lookup.data ?? { error: "User lookup failed" });
    }

    const user = lookup.data?.user ?? lookup.data ?? {};
    const id = String(user.id ?? user._id ?? user.userId ?? "");
    if (!id) return res.status(404).json({ error: "User not found" });

    // 2) Hash and PUT to user service
    const newHash = await bcrypt.hash(newPassword, 10);
    const update = await s2sRequestBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      `${config.userRouteUsers}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        timeoutMs: 5000,
        headers: { "Content-Type": "application/json" },
        body: { password: newHash, dateLastUpdated: new Date().toISOString() },
      }
    );

    if (!update.ok) {
      logger.error(
        { requestId, status: update.status, data: update.data },
        "[AuthHandlers.passwordReset] update error"
      );
      return res
        .status(update.status)
        .send(update.data ?? { error: "Password update failed" });
    }

    (req as any).audit?.push({
      type: "AUTH_PASSWORD_RESET",
      entity: "User",
      entityId: id,
      data: { email },
    });

    logger.debug(
      { requestId, userId: id },
      "[AuthHandlers.passwordReset] exit"
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.debug({ requestId, err }, "[AuthHandlers.passwordReset] error");
    return next(err as Error);
  }
}
