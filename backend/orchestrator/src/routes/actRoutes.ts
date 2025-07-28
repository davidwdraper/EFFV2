import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';

const router = express.Router();
const SERVICE_URL = process.env.ACT_SERVICE_URL || 'http://act-service:4002';

router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
