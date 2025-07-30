import express from 'express';
import { proxyRequest } from '../utils/proxyHelper';
import authenticate from '../middleware/authenticate';

const router = express.Router();

const SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';

// 🔒 Only protect PUT and DELETE
router.use((req, res, next) => {
  const needsAuth = ['PUT', 'DELETE'].includes(req.method.toUpperCase());
  if (needsAuth) {
    return authenticate(req, res, next);
  }
  next(); // skip auth for GET and POST
});

// 🔁 Forward all requests to user service
router.all('*', (req, res) => proxyRequest(req, res, SERVICE_URL));

export default router;
