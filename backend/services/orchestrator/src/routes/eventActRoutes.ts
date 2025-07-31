import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from './shared/env'; // adjust path if needed

const router = express.Router();
const SERVICE_URL = process.env.EVENTACT_SERVICE_URL || 'http://localhost:4008';

// Injected auth middleware
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🔒 Apply auth to all EventAct requests
router.use(authenticate);

// 🔁 Proxy all EventAct service traffic
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
