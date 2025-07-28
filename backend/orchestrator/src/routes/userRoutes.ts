import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';

const router = express.Router();
const SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001/users';
console.log(`[userRoutes] → ${SERVICE_URL}`);
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
