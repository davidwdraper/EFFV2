// PATH: backend/services/auth/src/handlers/auth/passwordReset.ts
/**
 * POST /api/auth/password_reset
 * Body: { email, newPassword }
 * Behavior: lookup user id via private email (S2S), PUT new hashed password to User.
 *
 * Transport:
 * - Uses callBySlug for both lookup and update.
 */

import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import { logger } from "@eff/shared/src/utils/logger";
import { config } from "../../config";

function pickPayload(resp: any) {
  return resp?.body ?? resp?.data ?? resp?.payload ?? undefined;
}

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
    const lookup = await callBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      {
        method: "GET",
        path: `${config.userRoutePrivateEmail}/${encodeURIComponent(email)}`,
        timeoutMs: 5000,
      }
    );

    const lookupStatus = Number(lookup.status || 0);
    const lookupPayload = pickPayload(lookup);

    if (lookupStatus === 404)
      return res.status(404).json({ error: "User not found" });
    if (!(lookupStatus >= 200 && lookupStatus < 300)) {
      logger.error(
        { requestId, status: lookupStatus, data: lookupPayload },
        "[AuthHandlers.passwordReset] lookup error"
      );
      return res
        .status(lookupStatus || 502)
        .send(lookupPayload ?? { error: "User lookup failed" });
    }

    const user = lookupPayload?.user ?? lookupPayload ?? {};
    const id = String(user.id ?? user._id ?? user.userId ?? "");
    if (!id) return res.status(404).json({ error: "User not found" });

    // 2) Hash and PUT to user service
    const newHash = await bcrypt.hash(newPassword, 10);

    const update = await callBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      {
        method: "PUT",
        path: `${config.userRouteUsers}/${encodeURIComponent(id)}`,
        timeoutMs: 5000,
        headers: { "content-type": "application/json" },
        body: { password: newHash, dateLastUpdated: new Date().toISOString() },
      }
    );

    const updateStatus = Number(update.status || 0);
    const updatePayload = pickPayload(update);

    if (!(updateStatus >= 200 && updateStatus < 300)) {
      logger.error(
        { requestId, status: updateStatus, data: updatePayload },
        "[AuthHandlers.passwordReset] update error"
      );
      return res
        .status(updateStatus || 502)
        .send(updatePayload ?? { error: "Password update failed" });
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
