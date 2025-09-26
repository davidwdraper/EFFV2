// PATH: backend/services/auth/src/handlers/auth/create.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *
 * Why:
 * - Auth calls User via shared S2S (`callBySlug`) resolved by svcconfig.
 * - Flow: validate → create user (NO password) → hash & PATCH password → mint token → audit → return.
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
function pickText(resp: any): string | undefined {
  return typeof resp?.text === "string" ? resp.text : undefined;
}

const DOWNSTREAM_TIMEOUT = Number(
  process.env.TIMEOUT_AUTH_DOWNSTREAM_MS || 6000
);

const USER_CREATE_PATH = "/users";
const USER_PATCH_PATH = (id: string) => `/users/${encodeURIComponent(id)}`;

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
    const middlenameRaw = String(req.body?.middlename || "").trim();
    const lastname = String(req.body?.lastname || "").trim();
    const password = String(req.body?.password || "");

    if (!email || !password || !firstname || !lastname) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Missing required fields: email, password, firstname, lastname",
      });
    }

    const middlename = middlenameRaw || undefined;

    // 1) Create user — NO password in create contract
    const createBody = { email, firstname, middlename, lastname };
    const respCreate = await callBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      {
        method: "PUT",
        path: USER_CREATE_PATH,
        timeoutMs: DOWNSTREAM_TIMEOUT,
        headers: { "content-type": "application/json" },
        body: createBody,
      }
    );

    const statusCreate = Number(respCreate?.status || 0);
    const payloadCreate = pickPayload(respCreate);
    const textCreate = pickText(respCreate);

    if (!(statusCreate >= 200 && statusCreate < 300)) {
      const problem =
        payloadCreate && typeof payloadCreate === "object"
          ? payloadCreate
          : {
              type: "about:blank",
              title: statusCreate === 504 ? "Gateway Timeout" : "Bad Gateway",
              status: statusCreate || 502,
              detail: textCreate || "User create failed",
            };
      logger.error(
        { requestId, status: statusCreate, data: payloadCreate ?? textCreate },
        "[AuthHandlers.create] downstream error (create)"
      );
      return res.status(problem.status || statusCreate || 502).json(problem);
    }

    const created = payloadCreate?.user ?? payloadCreate ?? {};
    const id = String(created.id ?? created._id ?? created.userId ?? "");
    if (!id) {
      logger.error(
        { requestId, created },
        "[AuthHandlers.create] no id in create response"
      );
      return res.status(502).json({
        type: "about:blank",
        title: "Bad Gateway",
        status: 502,
        detail: "User create returned no id",
      });
    }

    // 2) Hash & PATCH password into user
    const hashedPassword = await bcrypt.hash(password, 10);
    const respPatch = await callBySlug<any>(
      config.userSlug,
      config.userApiVersion,
      {
        method: "PATCH",
        path: USER_PATCH_PATH(id),
        timeoutMs: DOWNSTREAM_TIMEOUT,
        headers: { "content-type": "application/json" },
        body: { password: hashedPassword },
      }
    );

    const statusPatch = Number(respPatch?.status || 0);
    const payloadPatch = pickPayload(respPatch);
    const textPatch = pickText(respPatch);

    if (!(statusPatch >= 200 && statusPatch < 300)) {
      const problem =
        payloadPatch && typeof payloadPatch === "object"
          ? payloadPatch
          : {
              type: "about:blank",
              title: statusPatch === 504 ? "Gateway Timeout" : "Bad Gateway",
              status: statusPatch || 502,
              detail: textPatch || "User password set failed",
            };
      logger.error(
        {
          requestId,
          userId: id,
          status: statusPatch,
          data: payloadPatch ?? textPatch,
        },
        "[AuthHandlers.create] downstream error (patch password)"
      );
      return res.status(problem.status || statusPatch || 502).json(problem);
    }

    // 3) Issue KMS-signed token and respond
    const safeUser = {
      id,
      email: String(created.email ?? email).toLowerCase(),
      firstname: created.firstname ?? firstname,
      middlename: created.middlename ?? middlename,
      lastname: created.lastname ?? lastname,
    };

    const token = await generateToken({
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
      data: { email: safeUser.email },
    });

    logger.debug({ requestId, userId: id }, "[AuthHandlers.create] exit");
    return res.status(201).json({ token, user: safeUser });
  } catch (err) {
    logger.debug({ requestId, err }, "[AuthHandlers.create] error");
    return next(err as Error);
  }
}
