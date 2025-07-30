import express from 'express';
import { UserModel } from '../models/User';
import { authenticate } from '../middleware/authenticate';
import {
  createUser,
  getUserByEmail,
} from '../controllers/userController';

const router = express.Router();

// 🛡️ POST - Create a user (authenticated)
router.post('/', authenticate, createUser);

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
    const user = await UserModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    console.error('[User] GET /:id - Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✏️ PUT - Update user by ID (authenticated)
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

// ❌ DELETE - Delete user by ID (authenticated)
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
