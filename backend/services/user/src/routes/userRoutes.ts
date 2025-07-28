import express from 'express';
import User from '../models/User';
import { authenticate } from '../middleware/authenticate';
import { createUser } from '../controllers/userController';

const router = express.Router();

router.post('/', authenticate, createUser);

router.get('/', async (req, res) => {
  const users = await User.find();
  res.send(users);
});

router.get('/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).send({ error: 'Not found' });
  res.send(user);
});

router.put('/:id', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!user) return res.status(404).send({ error: 'Not found' });
  res.send(user);
});

router.delete('/:id', async (req, res) => {
  const result = await User.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).send({ error: 'Not found' });
  res.send({ success: true });
});

export default router;