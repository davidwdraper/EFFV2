// backend/services/shared/src/types/express.d.ts

import type { JwtPayload } from "jsonwebtoken";

/**
 * Global Express request augmentation used by all services.
 * - audit: controllers push business events; flushed by shared audit middleware
 * - requestId: set by logging middleware
 * - s2s: payload from verifyS2S (short-lived internal JWT)
 */
declare global {
  namespace Express {
    interface Request {
      audit?: Array<Record<string, unknown>>;
      requestId?: string;
      s2s?: JwtPayload & { svc?: string; iss?: string; aud?: string };
    }
  }
}

export {};
