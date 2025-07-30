import jwt from 'jsonwebtoken';
import { AuthPayload } from '../types/express/AuthPayload';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET;
const DISABLE_AUTH = process.env.DISABLE_AUTH === 'true';

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  console.log('[User] req: ', req);

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const payload = jwt.verify(token, "2468"); // direct test
    console.log('[Auth] Decoded:', payload);
  } catch (err) {
    if (err instanceof Error) {
      console.error('[Auth] Verification error:', err.message);
    } else {
      console.error('[Auth] Verification unknown error:', err);
    }
  }

  try {
    console.log('[Auth] JWT_SECRET:', process.env.JWT_SECRET);
    console.log('[Auth] JWT_SECRET const:', JWT_SECRET);

    const payload = decodeJwt(token);
    if (!payload) {
      return res.status(401).json({ error: 'decodeJwt - Invalid or expired token' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  function decodeJwt(token: string): AuthPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET!);
      console.log('[Auth] decoded: ', decoded);

      if (
        typeof decoded === 'object' &&
        decoded &&
        '_id' in decoded &&
        'userType' in decoded &&
        'lastname' in decoded &&
        'firstname' in decoded &&
        'eMailAddr' in decoded
      ) {
        return {
        _id: decoded._id as string,
        userType: decoded.userType as number,
        firstname: decoded.firstname as string,
        lastname: decoded.lastname as string,
        eMailAddr: decoded.eMailAddr as string,
      };
      }
      return null;
    } catch {
      return null;
    }
  }
};
