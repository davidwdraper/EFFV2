// backend/services/auth/src/handlers/auth/create.ts
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
 * - Add hard, local timeouts (Promise.race) + breadcrumbs so we never "hang" past curl's 5s cap.
 */

import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import { logger } from "@eff/shared/src/utils/logger";
import { config as authConfig } from "../../config";
import { mintUserAssertion as generateToken } from "@eff/shared/src/utils/s2s/mintUserAssertion";

function pickPayload(resp: any) {
  return resp?.body ?? resp?.data ?? resp?.payload ?? undefined;
}
function pickText(resp: any): string | undefined {
  return typeof resp?.text === "string" ? resp.text : undefined;
}

// Narrow to auth config fields we rely on
type AuthConfigShape = typeof authConfig & {
  userSlug: string;
  userApiVersion: string;
  userRouteUsers: string;
  userRoutePrivateEmail: string;
};
const cfg = authConfig as AuthConfigShape;

// Fail **before** curl's 5s cap; enforce locally with Promise.race as a belt-and-suspenders
const DOWNSTREAM_TIMEOUT = Math.min(
  Number(process.env.TIMEOUT_AUTH_DOWNSTREAM_MS || 4500),
  4500
);

const USER_CREATE_PATH = "/users";
const USER_PATCH_PATH = (id: string) => `/users/${encodeURIComponent(id)}`;

function raceWithTimeout<T>(
  p: Promise<T>,
  ms: number,
  tag: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const err: any = new Error(`${tag}: timeout after ${ms}ms`);
      err.status = 504;
      reject(err);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export default async function create(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  const t0 = Date.now();
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
    logger.debug(
      { requestId, slug: cfg.userSlug, ver: cfg.userApiVersion },
      "[AuthHandlers.create] calling user create"
    );
    const respCreate = await raceWithTimeout(
      callBySlug<any>(cfg.userSlug, cfg.userApiVersion, {
        // Keep PUT to match contract; user also accepts POST for compatibility
        method: "PUT",
        path: USER_CREATE_PATH,
        timeoutMs: DOWNSTREAM_TIMEOUT,
        headers: { "content-type": "application/json" },
        body: createBody,
      }),
      DOWNSTREAM_TIMEOUT + 100, // slight cushion; still < curl 5s
      "user.create"
    );
    const tCreate = Date.now();

    const statusCreate = Number(respCreate?.status || 0);
    const payloadCreate = pickPayload(respCreate);
    const textCreate = pickText(respCreate);

    if (!(statusCreate >= 200 && statusCreate < 300)) {
      logger.error(
        {
          requestId,
          dt: tCreate - t0,
          status: statusCreate,
          data: payloadCreate ?? textCreate,
        },
        "[AuthHandlers.create] downstream error (create)"
      );
      const problem =
        payloadCreate && typeof payloadCreate === "object"
          ? payloadCreate
          : {
              type: "about:blank",
              title: statusCreate === 504 ? "Gateway Timeout" : "Bad Gateway",
              status: statusCreate || 502,
              detail: textCreate || "User create failed",
            };
      return res.status(problem.status || statusCreate || 502).json(problem);
    }

    const created = payloadCreate?.user ?? payloadCreate ?? {};
    const id = String(created.id ?? created._id ?? created.userId ?? "");
    if (!id) {
      logger.error(
        { requestId, created, dt: tCreate - t0 },
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
    const cost = Number(process.env.BCRYPT_COST || 10);
    const hashedPassword = await bcrypt.hash(password, cost);
    logger.debug(
      { requestId, userId: id },
      "[AuthHandlers.create] patching password"
    );
    const respPatch = await raceWithTimeout(
      callBySlug<any>(cfg.userSlug, cfg.userApiVersion, {
        method: "PATCH",
        path: USER_PATCH_PATH(id),
        timeoutMs: DOWNSTREAM_TIMEOUT,
        headers: { "content-type": "application/json" },
        body: { password: hashedPassword },
      }),
      DOWNSTREAM_TIMEOUT + 100,
      "user.patch"
    );
    const tPatch = Date.now();

    const statusPatch = Number(respPatch?.status || 0);
    const payloadPatch = pickPayload(respPatch);
    const textPatch = pickText(respPatch);

    if (!(statusPatch >= 200 && statusPatch < 300)) {
      logger.error(
        {
          requestId,
          userId: id,
          dt: tPatch - tCreate,
          status: statusPatch,
          data: payloadPatch ?? textPatch,
        },
        "[AuthHandlers.create] downstream error (patch password)"
      );
      const problem =
        payloadPatch && typeof payloadPatch === "object"
          ? payloadPatch
          : {
              type: "about:blank",
              title: statusPatch === 504 ? "Gateway Timeout" : "Bad Gateway",
              status: statusPatch || 502,
              detail: textPatch || "User password set failed",
            };
      return res.status(problem.status || statusPatch || 502).json(problem);
    }

    // 3) Issue KMS-signed user assertion token and respond
    const safeUser = {
      id,
      email: String(created.email ?? email).toLowerCase(),
      firstname: created.firstname ?? firstname,
      middlename: created.middlename ?? middlename,
      lastname: created.lastname ?? lastname,
    };

    const token = await generateToken({
      sub: id,
      iss: process.env.SERVICE_NAME || "auth",
      aud: process.env.USER_ASSERTION_AUDIENCE || "internal-services",
      nv: {
        email: safeUser.email,
        firstname: safeUser.firstname,
        middlename: safeUser.middlename,
        lastname: safeUser.lastname,
      },
    });

    (req as any).audit?.push({
      type: "AUTH_CREATE",
      entity: "User",
      entityId: id,
      data: { email: safeUser.email },
    });

    logger.debug(
      { requestId, userId: id, totalMs: Date.now() - t0 },
      "[AuthHandlers.create] exit"
    );
    return res.status(201).json({ token, user: safeUser });
  } catch (err: any) {
    const status = Number(err?.status || 500);
    if (status === 504) {
      logger.error(
        { requestId, err: String(err?.message || err) },
        "[AuthHandlers.create] hard timeout"
      );
      return res.status(504).json({
        type: "about:blank",
        title: "Gateway Timeout",
        status: 504,
        detail: err?.message || "Upstream timeout",
      });
    }
    logger.debug({ requestId, err }, "[AuthHandlers.create] error");
    return next(err as Error);
  }
}
