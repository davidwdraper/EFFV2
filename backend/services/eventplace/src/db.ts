// src/db.ts
import mongoose from 'mongoose';
import { config } from './config';

mongoose
  .connect(config.mongoUri)
  .then(() => console.log('[MongoDB] connected'))
  .catch((err) => console.error('[MongoDB] connection error:', err));
