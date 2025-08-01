import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { AuthPayload } from "@shared/types/AuthPayload";
import { logger } from "@shared/utils/logger";

// Factory function to create middleware with a given secret
export const createAuthenticateMiddleware = (jwtSecret: string) => {
  logger.debug("In createAuthenticateMiddleware");

  if (!jwtSecret) {
    logger.error("Missing JWT_SECRET");
    throw new Error("[Auth] JWT_SECRET is required");
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];

    if (!token) {
      console.warn("[Auth] Missing token");
      logger.error("Missing token");
      return res.status(401).json({ error: "Missing token" });
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      console.log("[Auth] Token verified:", decoded);

      if (
        typeof decoded === "object" &&
        decoded &&
        "_id" in decoded &&
        "userType" in decoded &&
        "firstname" in decoded &&
        "lastname" in decoded &&
        "eMailAddr" in decoded
      ) {
        req.user = {
          _id: decoded._id as string,
          userType: decoded.userType as number,
          firstname: decoded.firstname as string,
          lastname: decoded.lastname as string,
          eMailAddr: decoded.eMailAddr as string,
        } as AuthPayload;
        return next();
      } else {
        console.warn("[Auth] Token payload missing required fields");
        return res.status(401).json({ error: "Malformed token payload" });
      }
    } catch (err) {
      console.error("[Auth] Token verification failed:", err);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
};

// Default shared middleware using env var
const jwtSecret = process.env.JWT_SECRET || "";
export const authenticate = createAuthenticateMiddleware(jwtSecret);
