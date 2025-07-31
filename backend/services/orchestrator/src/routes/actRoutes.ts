import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from './shared/env'; // adjust path if needed

const router = express.Router();
const SERVICE_URL = process.env.ACT_SERVICE_URL || 'http://localhost:4002';

let authenticate: express.RequestHandler;

// 🛡️ Safe middleware injection
try {
  authenticate = createAuthenticateMiddleware(JWT_SECRET);
} catch (err) {
  console.error('[actRoutes] Failed to initialize authentication middleware:', err);
  authenticate = (_req, res, _next) => {
    res.status(500).json({ error: 'Authentication system misconfigured' });
  };
}

// 🔒 Protect all Act requests
router.use(authenticate);

// 🔁 Proxy to Act service
router.all('*', (req, res) => {
  try {
    proxyRequest(req, res, SERVICE_URL);
  } catch (err) {
    console.error('[actRoutes] Proxy error:', err);
    res.status(500).json({ error: 'Internal proxy error' });
  }
});

export default router;
