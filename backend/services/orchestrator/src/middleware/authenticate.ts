import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const createAuthenticateMiddleware = (jwtSecret: string) => {
  if (!jwtSecret) {
    throw new Error('[Auth] JWT_SECRET is required when creating middleware');
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('[Auth] Missing or malformed Authorization header:', authHeader);
      return res.status(401).json({ error: 'Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, jwtSecret) as any;

      // Optional: Inject user info for downstream use
      req.headers['x-user-type'] = decoded.userType?.toString();
      req.headers['x-user-email'] = decoded.eMailAddr;

      next();
    } catch (err) {
      console.error('[Auth] Token verification failed:', err);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
};
