import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from '../routes/shared/env'; // adjust path if needed

const router = express.Router();
const SERVICE_URL = process.env.EVENTPLACE_SERVICE_URL || 'http://localhost:4009';

// Inject JWT secret into middleware
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔒 Protect all EventPlace requests
router.use(authenticate);

// 🔁 Proxy to EventPlace service
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
