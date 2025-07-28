import express from 'express';
import Event from '../models/Event';

const router = express.Router();

router.post('/', async (req, res) => {
  const event = new Event(req.body);
  await event.save();
  res.status(201).send(event);
});

router.get('/', async (req, res) => {
  const events = await Event.find();
  res.send(events);
});

router.get('/:id', async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) return res.status(404).send({ error: 'Not found' });
  res.send(event);
});

router.put('/:id', async (req, res) => {
  const event = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!event) return res.status(404).send({ error: 'Not found' });
  res.send(event);
});

router.delete('/:id', async (req, res) => {
  const result = await Event.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).send({ error: 'Not found' });
  res.send({ success: true });
});

export default router;