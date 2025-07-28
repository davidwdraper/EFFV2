import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const PUBLIC_PATHS = ['/signup', '/login', '/passwordRecover', '/healthCheck'];
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Allow unauthenticated access to versioned public routes
    const isPublic = PUBLIC_PATHS.some(publicPath => req.path.endsWith(publicPath));

    if (!AUTH_ENABLED || isPublic) {
      return next(); // Auth is globally disabled or path is public
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error('JWT_SECRET not set in environment');
    }

    const decoded = jwt.verify(token, secret) as any;

    // Inject user info into headers for downstream services
    req.headers['x-user-type'] = decoded.userType?.toString();
    req.headers['x-user-email'] = decoded.email;

    next();
  } catch (err) {
    console.error('[Orchestrator] Token verification failed:', err);
    res.status(401).json({ error: 'Token verification failed' });
  }
};

export default authenticate;
