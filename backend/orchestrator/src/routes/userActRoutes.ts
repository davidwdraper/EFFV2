import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import authenticate from '../middleware/authenticate';

const router = express.Router();
const SERVICE_URL = process.env.USERACT_SERVICE_URL || 'http://localhost:4010';

router.use(authenticate);
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
