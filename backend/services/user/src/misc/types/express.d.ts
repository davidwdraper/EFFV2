import { AuthPayload } from './express';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export interface AuthPayload {
  _id: string;
  userType: number;
  firstname: string;
  lastname: string;
  eMailAddr: string;
}