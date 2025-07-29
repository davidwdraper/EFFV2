import express from 'express';
import { UserModel } from '../models/User';
import { authenticate } from '../middleware/authenticate';
import {
  createUser,
  getUserByEmail
} from '../controllers/userController';

const router = express.Router();

// 🛡️ Create a user (authenticated)
router.post('/', authenticate, createUser);

// 🔍 Get user by email – must come before /:id to avoid being shadowed
router.get('/email/:eMailAddr', getUserByEmail);

// 📋 Get all users
router.get('/', async (req, res) => {
  const users = await UserModel.find();
  res.send(users);
});

// 📄 Get user by ID
router.get('/:id', async (req, res) => {
  const user = await UserModel.findById(req.params.id);
  if (!user) return res.status(404).send({ error: 'Not found' });
  res.send(user);
});

// ✏️ Update user by ID
router.put('/:id', async (req, res) => {
  const user = await UserModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!user) return res.status(404).send({ error: 'Not found' });
  res.send(user);
});

// ❌ Delete user by ID
router.delete('/:id', async (req, res) => {
  const result = await UserModel.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).send({ error: 'Not found' });
  res.send({ success: true });
});

export default router;
