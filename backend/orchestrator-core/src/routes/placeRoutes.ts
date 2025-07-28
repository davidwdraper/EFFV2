import express from 'express';
const router = express.Router();

// GET all places
router.get('/', (req, res) => {
  res.status(200).json({ data: [], message: 'Successfully fetched places (stub)' });
});

// CREATE a new place
router.post('/', (req, res) => {
  res.status(201).json({ message: 'Place created (stub)', place: req.body });
});

// UPDATE a place
router.put('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'Place ' + id + ' updated (stub)', updatedFields: req.body });
});

// DELETE a place
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'Place ' + id + ' deleted (stub)' });
});

export default router;