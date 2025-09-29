// src/types/express.d.ts (or similar)

import { AuthPayload } from './AuthPayload';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}
