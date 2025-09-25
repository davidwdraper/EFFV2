// backend/services/shared/middleware/authenticate.ts
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
// ⬇️ Use the canonical type your codebase expects
import type { AuthPayload } from "@eff/shared/src/types/AuthPayload";

/** What we expect to live on req.user (decoded, loosely typed input) */
export interface AuthUser extends JwtPayload {
  _id: string;
  userType?: number;
  email?: string;
  firstname?: string;
  middlename?: string;
  lastname?: string;
}

/** Module augmentation: add `user` to Express.Request with the canonical shape */
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthPayload;
  }
}

/** Normalize a decoded token into the required AuthPayload (all required fields present) */
function toAuthPayload(obj: Partial<AuthUser> | JwtPayload): AuthPayload {
  const id = (obj as any)?._id ?? (obj as any)?.sub ?? "";
  const email =
    (obj as any)?.email ?? (obj as any)?.eMailAddr ?? (obj as any)?.mail ?? "";
  const firstname =
    (obj as any)?.firstname ??
    (obj as any)?.firstName ??
    (obj as any)?.given_name ??
    "";
  const lastname =
    (obj as any)?.lastname ??
    (obj as any)?.lastName ??
    (obj as any)?.family_name ??
    "";
  const middlename =
    (obj as any)?.middlename ?? (obj as any)?.middleName ?? undefined;

  // userType is REQUIRED by your canonical AuthPayload; validate strictly
  const rawUserType = (obj as any)?.userType;
  const userTypeNum =
    typeof rawUserType === "number"
      ? rawUserType
      : Number.isFinite(Number(rawUserType))
      ? Number(rawUserType)
      : NaN;
  if (!Number.isFinite(userTypeNum)) {
    // Fail fast per SOP: no fallbacks / no silent defaults
    throw new Error("authenticate: missing or invalid userType");
  }

  return {
    _id: String(id ?? ""),
    email: String(email ?? ""),
    firstname: String(firstname ?? ""),
    lastname: String(lastname ?? ""),
    userType: userTypeNum as number,
    ...(middlename !== undefined ? { middlename: String(middlename) } : {}),
  };
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Bearer ")) {
    return res
      .status(401)
      .send({ error: "Missing or malformed Authorization header" });
  }

  const token = auth.slice(7).trim();
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res
      .status(500)
      .send({ error: "Server misconfigured: JWT_SECRET is not set" });
  }

  try {
    const decoded = jwt.verify(token, secret);

    // Ensure we only accept object payloads, never strings
    if (typeof decoded !== "object" || decoded === null) {
      return res.status(401).send({ error: "Invalid token payload" });
    }

    // Normalize → canonical type; validate required fields
    const partial = decoded as Partial<AuthUser>;
    const normalized = toAuthPayload(partial);

    if (!normalized._id) {
      return res.status(401).send({ error: "Invalid token: missing _id" });
    }

    req.user = normalized; // ✅ matches import("/shared/src/types/AuthPayload").AuthPayload
    return next();
  } catch (err: any) {
    const msg =
      err?.message === "authenticate: missing or invalid userType"
        ? err.message
        : "Invalid or expired token";
    return res.status(401).send({ error: msg });
  }
}
