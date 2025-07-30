import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from '../routes/shared/env'; // adjust path if needed

const router = express.Router();
const SERVICE_URL = process.env.USERACT_SERVICE_URL || 'http://localhost:4010';

// 🔒 Create injected auth middleware
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔐 Protect all routes
router.use(authenticate);

// 🔁 Proxy all requests to the UserAct service
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
