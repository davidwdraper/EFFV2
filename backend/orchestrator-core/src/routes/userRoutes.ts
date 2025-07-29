import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';

const router = express.Router();

// Use environment variable or fallback to Docker service name
const SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:4001';

console.log(`[orchestrator-core:userRoutes] Proxying to ${SERVICE_URL}`);

// Forward all /Users requests to userService
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
