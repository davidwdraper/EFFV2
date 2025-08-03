// src/utils/jwtUtils.ts
import jwt from "jsonwebtoken";
import { logger } from "@shared/utils/logger";

// ✅ Fail fast if secret is not provided
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set.");
}

// ✅ Explicitly type the secret
const SECRET: string = process.env.JWT_SECRET;

/**
 * Generates a JWT token for the given payload.
 * @param payload Object to encode in the token
 * @returns Signed JWT token
 */
export function generateToken(payload: object): string {
  logger.debug("authService: Generating JWT token", {
    payloadKeys: Object.keys(payload),
  });

  return jwt.sign(payload, SECRET, { expiresIn: "1h" });
}
