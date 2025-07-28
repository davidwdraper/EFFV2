import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const router = express.Router();
const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';

router.get('/events-with-place', async (req, res) => {
  try {
    const headers: Record<string, string> = {};
    if (AUTH_ENABLED) {
      if (req.headers.authorization) headers['Authorization'] = req.headers.authorization as string;
      if (req.headers['x-user-type']) headers['x-user-type'] = req.headers['x-user-type'] as string;
      if (req.headers['x-user-email']) headers['x-user-email'] = req.headers['x-user-email'] as string;
    }

    const events = (await axios.get('http://event:4004/events', { headers })).data;
    const places = (await axios.get('http://place:4003/places', { headers })).data;

    const placesMap = Object.fromEntries(places.map((p: any) => [p._id, p]));
    const combined = events.map((event: any) => ({
      ...event,
      place: placesMap[event.placeId] || null
    }));

    res.json(combined);
  } catch (err: any) {
    console.error('[Composite] Error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch composite data',
      details: err.response?.data || err.message,
    });
  }
});

export default router;