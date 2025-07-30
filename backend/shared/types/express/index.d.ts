// backend/shared/types/express/index.d.ts
import { AuthPayload } from '../AuthPayload'; // adjust if needed

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}
