import express from 'express';
import Place from '../models/Place';

const router = express.Router();

router.post('/', async (req, res) => {
  const place = new Place(req.body);
  await place.save();
  res.status(201).send(place);
});

router.get('/', async (req, res) => {
  const places = await Place.find();
  res.send(places);
});

router.get('/:id', async (req, res) => {
  const place = await Place.findById(req.params.id);
  if (!place) return res.status(404).send({ error: 'Not found' });
  res.send(place);
});

router.put('/:id', async (req, res) => {
  const place = await Place.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!place) return res.status(404).send({ error: 'Not found' });
  res.send(place);
});

router.delete('/:id', async (req, res) => {
  const result = await Place.findByIdAndDelete(req.params.id);
  if (!result) return res.status(404).send({ error: 'Not found' });
  res.send({ success: true });
});

export default router;