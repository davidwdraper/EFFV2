import express from 'express';
const router = express.Router();

// GET all users
router.get('/', (req, res) => {
  res.status(200).json({ data: [], message: 'Successfully fetched users (stub)' });
});

// CREATE a new user
router.post('/', (req, res) => {
  res.status(201).json({ message: 'User created (stub)', user: req.body });
});

// UPDATE a user
router.put('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'User ' + id + ' updated (stub)', updatedFields: req.body });
});

// DELETE a user
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'User ' + id + ' deleted (stub)' });
});

export default router;