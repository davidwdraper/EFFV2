// backend/services/shared/src/types/express.d.ts

import type { JwtPayload } from "jsonwebtoken";
import type pino from "pino";

/**
 * Global Express request augmentation used by all services.
 * - audit: controllers push business events; flushed by shared audit middleware
 * - requestId: set by logging middleware
 * - s2s: payload from verifyS2S (short-lived internal JWT)
 * - log: pino logger attached by pino-http
 * - user: attached by authenticate()
 */
declare global {
  namespace Express {
    interface Request {
      audit?: Array<Record<string, unknown>>;
      requestId?: string;
      s2s?: JwtPayload & { svc?: string; iss?: string; aud?: string };
      log: pino.Logger; // CHANGED: ensure req.log exists for TS
      user?: {
        _id: string;
        userType?: number;
        email?: string;
        firstname?: string;
        middlename?: string;
        lastname?: string;
        [k: string]: unknown;
      };
    }
  }
}

export {};
