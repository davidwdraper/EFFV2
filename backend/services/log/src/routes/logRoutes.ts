import express from 'express';
import Log from '../models/Log';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const log = new Log(req.body);
    await log.save();
    res.status(201).send({ success: true });
  } catch (err) {
    res.status(500).send({ error: 'Failed to save log', details: err });
  }
});

router.get('/', async (req, res) => {
  const logs = await Log.find().sort({ timestamp: -1 }).limit(100);
  res.send(logs);
});

export default router;