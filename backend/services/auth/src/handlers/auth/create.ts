// backend/services/auth/src/handlers/auth/create.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Auth now calls User directly via the shared S2S client resolved by svcconfig.
 * - Keep controller thin: validate → hash → S2S → issue token → audit → return.
 */

import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { s2sRequestBySlug } from "@eff/shared/src/utils/s2s/httpClientBySlug";
import { logger } from "@eff/shared/src/utils/logger";
import { config } from "../../config";
import { generateToken } from "../../utils/jwtUtils";

export default async function create(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[AuthHandlers.create] enter");
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const firstname = String(req.body?.firstname || "").trim();
    const middlename = String(req.body?.middlename || "").trim();
    const lastname = String(req.body?.lastname || "").trim();
    const password = String(req.body?.password || "");

    if (!email || !password || !firstname || !lastname) {
      return res
        .status(400)
        .json({
          error:
            "Missing required fields: email, password, firstname, lastname",
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const resp = await s2sRequestBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      config.userRouteUsers,
      {
        method: "POST",
        timeoutMs: 5000,
        headers: { "Content-Type": "application/json" },
        body: {
          email,
          password: hashedPassword,
          firstname,
          middlename,
          lastname,
        },
      }
    );

    if (!resp.ok) {
      logger.error(
        { requestId, status: resp.status, data: resp.data },
        "[AuthHandlers.create] downstream error"
      );
      return res
        .status(resp.status)
        .send(resp.data ?? { error: "User create failed" });
    }

    const created = resp.data?.user ?? resp.data ?? {};
    const id = String(created.id ?? created._id ?? created.userId ?? "");
    const safeUser = {
      id,
      email: String(created.email ?? email).toLowerCase(),
      firstname: created.firstname ?? firstname,
      middlename: created.middlename ?? (middlename || undefined),
      lastname: created.lastname ?? lastname,
    };

    const token = generateToken({
      id,
      email: safeUser.email,
      firstname: safeUser.firstname,
      middlename: safeUser.middlename,
      lastname: safeUser.lastname,
    });

    (req as any).audit?.push({
      type: "AUTH_CREATE",
      entity: "User",
      entityId: id,
      data: { email },
    });

    logger.debug({ requestId, userId: id }, "[AuthHandlers.create] exit");
    return res.status(201).json({ token, user: safeUser });
  } catch (err) {
    logger.debug({ requestId, err }, "[AuthHandlers.create] error");
    return next(err as Error);
  }
}
