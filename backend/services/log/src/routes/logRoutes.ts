import express from 'express';
import { LogModel } from '../models/Log';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const logEntry = new LogModel(req.body);
    await logEntry.save();
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[LogService] Failed to save log:', err);
    res.status(500).json({ error: 'Failed to save log' });
  }
});

export default router;
