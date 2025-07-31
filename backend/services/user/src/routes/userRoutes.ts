import express from 'express';
import { UserModel } from '../models/User';
import { createAuthenticateMiddleware } from '../middleware/authenticate';
import { JWT_SECRET } from './shared/env'; // adjust path if needed
import { logger } from '@shared/utils/logger';
import {
  createUser,
  getUserByEmail
} from '../controllers/userController';

const router = express.Router();

// Inject JWT_SECRET into middleware
const authenticate = createAuthenticateMiddleware(JWT_SECRET);

// 🛡️ POST - Create a user (anonymous/public)
router.post('/', createUser);

// 🔍 GET - Get user by email (public)
router.get('/email/:eMailAddr', getUserByEmail);

// 📋 GET - Get all users (public)
router.get('/', async (req, res) => {
  try {
    const users = await UserModel.find();
    res.status(200).json(users);
  } catch (err) {
    console.error('[User] GET / - Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 📄 GET - Get user by ID (public)
router.get('/:id', async (req, res) => {
  try {
    logger.debug("[User] GET/id: " + req.params.id);
    console.log("[User] GET/id: ", req.params.id);

    const user = await UserModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    console.error('[User] GET /:id - Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✏️ PUT - Update user by ID (protected)
router.put('/:id', authenticate, async (req, res) => {
  try {
    const user = await UserModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    console.error('[User] PUT /:id - Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ❌ DELETE - Delete user by ID (protected)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await UserModel.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[User] DELETE /:id - Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
