// backend/services/shared/middleware/authenticate.ts
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

/** What we expect to live on req.user */
export interface AuthUser extends JwtPayload {
  _id: string;
  userType?: number;
  eMailAddr?: string;
  firstname?: string;
  middlename?: string;
  lastname?: string;
}

/** Module augmentation: add `user` to Express.Request */
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
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

    // Minimal sanity: require an _id
    const payload = decoded as Partial<AuthUser>;
    if (!payload._id) {
      return res.status(401).send({ error: "Invalid token: missing _id" });
    }

    req.user = payload as AuthUser;
    return next();
  } catch (_err) {
    return res.status(401).send({ error: "Invalid or expired token" });
  }
}
