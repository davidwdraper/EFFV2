import express from 'express';
import Act from '../models/Act';

const router = express.Router();

router.post('/', async (req, res) => {
  const act = new Act(req.body);
  await act.save();
  res.status(201).send(act);
});

router.get('/', async (req, res) => {
  const acts = await Act.find();
  res.send(acts);
});

router.get('/:id', async (req, res) => {
  const act = await Act.findById(req.params.id);
  if (!act) return res.status(404).send({ error: 'Not found' });
  res.send(act);
});

router.put('/:id', async (req, res) => {
  const act = await Act.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!act) return res.status(404).send({ error: 'Not found' });
  res.send(act);
});

router.delete('/:id', async (req, res) => {
  const result = await Act.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).send({ error: 'Not found' });
  res.send({ success: true });
});

export default router;