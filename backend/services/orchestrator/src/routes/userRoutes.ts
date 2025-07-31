import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from './shared/env'; // adjust path if needed

const router = express.Router();

const SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';

let authenticate: express.RequestHandler;

// 🛡️ Safe middleware injection
try {
  authenticate = createAuthenticateMiddleware(JWT_SECRET);
} catch (err) {
  console.error('[userRoutes] Failed to initialize authentication middleware:', err);
  // Middleware that fails all protected requests
  authenticate = (_req, res, _next) => {
    res.status(500).json({ error: 'Authentication system misconfigured' });
  };
}

// 🔒 Only protect PUT and DELETE
router.use((req, res, next) => {
  const needsAuth = ['PUT', 'DELETE'].includes(req.method.toUpperCase());
  if (needsAuth) {
    return authenticate(req, res, next);
  }
  next(); // skip auth for GET and POST
});

// 🔁 Forward all requests to user service
router.all('*', (req, res) => {
  try {
    proxyRequest(req, res, SERVICE_URL);
  } catch (err) {
    console.error('[userRoutes] Proxy error:', err);
    res.status(500).json({ error: 'Internal proxy error' });
  }
});

export default router;
