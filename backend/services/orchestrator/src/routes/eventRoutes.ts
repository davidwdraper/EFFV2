import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from './shared/env'; // adjust if needed

const router = express.Router();
const SERVICE_URL = process.env.EVENT_SERVICE_URL || 'http://localhost:4003';

// Inject JWT secret into auth middleware
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔒 Apply auth to all Event routes
router.use(authenticate);

// 🔁 Proxy all Event service traffic
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
