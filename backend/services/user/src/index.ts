import express from 'express';
import mongoose from 'mongoose';
import { config } from './config';

const app = express();

mongoose
  .connect(config.mongoUri)
  .then(() => console.log('[MongoDB] connected'))
  .catch((err) => console.error('[MongoDB] connection error:', err));

app.listen(config.port, () => {
  console.log(`User running on port ${config.port}`);
});
