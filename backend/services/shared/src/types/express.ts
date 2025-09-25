// services/shared/types/express.ts

import { AuthPayload } from "@eff/shared/src/types/AuthPayload";

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}
console.log("✅ Express augmentation loaded");

export {}; // must be a module
