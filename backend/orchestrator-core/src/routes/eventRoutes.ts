import express from 'express';
const router = express.Router();

// GET all events
router.get('/', (req, res) => {
  res.status(200).json({ data: [], message: 'Successfully fetched events (stub)' });
});

// CREATE a new event
router.post('/', (req, res) => {
  res.status(201).json({ message: 'Event created (stub)', event: req.body });
});

// UPDATE a event
router.put('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'Event ' + id + ' updated (stub)', updatedFields: req.body });
});

// DELETE a event
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'Event ' + id + ' deleted (stub)' });
});

export default router;