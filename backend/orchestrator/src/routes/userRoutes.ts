import express from 'express';
import axios from 'axios';

const router = express.Router();

router.get('/Users/:id', async (req, res) => {
  const targetUrl = `http://localhost:4001/Users/${req.params.id}`;
  console.log(`[direct proxy test] GET → ${targetUrl}`);

  try {
    const response = await axios.get(targetUrl);
    res.status(response.status).send(response.data);
  } catch (err: any) {
    const status = err.response?.status || 500;
    const message = err.message || 'Unknown error';
    console.error(`[direct proxy test error] ${status}: ${message}`);
    res.status(status).json({ error: message });
  }
});

export default router;
