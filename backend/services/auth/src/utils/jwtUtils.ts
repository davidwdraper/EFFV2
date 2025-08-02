import jwt from "jsonwebtoken";
import { logger } from "@shared/utils/logger";

const SECRET = process.env.JWT_SECRET || "dev-secret";

export function generateToken(payload: object): string {
  logger.debug("authService: Generating JWT token", {
    payloadKeys: Object.keys(payload),
  });

  return jwt.sign(payload, SECRET, { expiresIn: "1h" });
}
