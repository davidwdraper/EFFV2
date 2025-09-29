// PATH: backend/services/auth/src/handlers/auth/passwordReset.ts
/**
 * POST /api/auth/password_reset
 * Body: { email, newPassword }
 * Behavior: lookup user id via private email (S2S), PATCH hashed password to User.
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
function pickText(resp: any): string | undefined {
  return typeof resp?.text === "string" ? resp.text : undefined;
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
      return res
        .status(400)
        .json({
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "email and newPassword required",
        });
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
    const lookupText = pickText(lookup);

    if (lookupStatus === 404) {
      return res
        .status(404)
        .json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "User not found",
        });
    }
    if (!(lookupStatus >= 200 && lookupStatus < 300)) {
      logger.error(
        { requestId, status: lookupStatus, data: lookupPayload ?? lookupText },
        "[AuthHandlers.passwordReset] lookup error"
      );
      return res
        .status(lookupStatus || 502)
        .json(
          lookupPayload ?? {
            type: "about:blank",
            title: "Bad Gateway",
            status: 502,
            detail: "User lookup failed",
          }
        );
    }

    const user = lookupPayload?.user ?? lookupPayload ?? {};
    const id = String(user.id ?? user._id ?? user.userId ?? "");
    if (!id) {
      return res
        .status(404)
        .json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "User not found",
        });
    }

    // 2) Hash and PATCH to user service (PUT /:id is forbidden by SOP)
    const newHash = await bcrypt.hash(newPassword, 10);

    const update = await callBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      {
        method: "PATCH",
        path: `${config.userRouteUsers}/${encodeURIComponent(id)}`,
        timeoutMs: 5000,
        headers: { "content-type": "application/json" },
        body: { password: newHash },
      }
    );

    const updateStatus = Number(update.status || 0);
    const updatePayload = pickPayload(update);
    const updateText = pickText(update);

    if (!(updateStatus >= 200 && updateStatus < 300)) {
      logger.error(
        { requestId, status: updateStatus, data: updatePayload ?? updateText },
        "[AuthHandlers.passwordReset] update error"
      );
      return res
        .status(updateStatus || 502)
        .json(
          updatePayload ?? {
            type: "about:blank",
            title: "Bad Gateway",
            status: 502,
            detail: "Password update failed",
          }
        );
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
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.debug({ requestId, err }, "[AuthHandlers.passwordReset] error");
    return next(err as Error);
  }
}
