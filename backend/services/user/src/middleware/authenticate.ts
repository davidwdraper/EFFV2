import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/express/AuthPayload';
import { Request, Response, NextFunction } from 'express';

export const createAuthenticateMiddleware = (jwtSecret: string) => {
  if (!jwtSecret) {
    throw new Error('[Auth] JWT_SECRET is required');
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      console.warn('[Auth] Missing token');
      return res.status(401).json({ error: 'Missing token' });
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      console.log('[Auth] Token verified:', decoded);

      // Basic structural validation
      if (
        typeof decoded === 'object' &&
        decoded &&
        '_id' in decoded &&
        'userType' in decoded &&
        'lastname' in decoded &&
        'firstname' in decoded &&
        'eMailAddr' in decoded
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
        console.warn('[Auth] Token payload missing required fields');
        return res.status(401).json({ error: 'Malformed token payload' });
      }
    } catch (err) {
      console.error('[Auth] Token verification failed:', err);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
};
