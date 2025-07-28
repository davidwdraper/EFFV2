import express from 'express';
const router = express.Router();

// GET all acts
router.get('/', (req, res) => {
  res.status(200).json({ data: [], message: 'Successfully fetched acts (stub)' });
});

// CREATE a new act
router.post('/', (req, res) => {
  res.status(201).json({ message: 'Act created (stub)', act: req.body });
});

// UPDATE a act
router.put('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'Act ' + id + ' updated (stub)', updatedFields: req.body });
});

// DELETE a act
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  res.status(200).json({ message: 'Act ' + id + ' deleted (stub)' });
});

export default router;