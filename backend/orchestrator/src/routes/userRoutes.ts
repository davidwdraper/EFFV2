import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';

const router = express.Router();

// NOTE: This must match your docker-compose service name
const SERVICE_URL = process.env.USER_SERVICE_URL || 'http://user-service:4001';

router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
