import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from '../routes/shared/env'; // adjust path as needed

const router = express.Router();
const SERVICE_URL = process.env.LOG_SERVICE_URL || 'http://localhost:4006';

// 🔒 Inject the shared JWT secret
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔐 Apply authentication to all log routes
router.use(authenticate);

// 🔁 Proxy all log service requests
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
