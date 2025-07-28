import { AuthPayload } from './express';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export interface AuthPayload {
  userId: string;
  userType: number;
  firstname: string;
  lastname: string;
  eMailAddr: string;
}