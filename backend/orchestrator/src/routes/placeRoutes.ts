import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from '../routes/shared/env'; // adjust path if needed

const router = express.Router();
const SERVICE_URL = process.env.PLACE_SERVICE_URL || 'http://localhost:4004';

// Inject the secret into middleware
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔒 Apply authentication to all requests to Place service
router.use(authenticate);

// 🔁 Proxy all Place requests
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
