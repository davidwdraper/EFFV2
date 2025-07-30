import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from '../routes/shared/env'; // adjust path if needed

const router = express.Router();
const SERVICE_URL = process.env.ACT_SERVICE_URL || 'http://localhost:4002';

// Injected auth middleware
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔒 Protect all Act requests
router.use(authenticate);

// 🔁 Proxy to Act service
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
