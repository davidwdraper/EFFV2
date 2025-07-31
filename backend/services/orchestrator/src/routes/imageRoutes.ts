import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from './shared/env'; // adjust path as needed

const router = express.Router();
const SERVICE_URL = process.env.IMAGE_SERVICE_URL || 'http://localhost:4005';

// Injected auth middleware with shared JWT secret
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔒 Protect all Image service routes
router.use(authenticate);

// 🔁 Proxy all Image requests
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
