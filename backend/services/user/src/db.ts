// src/db.ts
import mongoose from 'mongoose';
import { config } from './config';
import { logger } from '@shared/utils/logger';

export const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    logger.info('[MongoDB-user] Connected');
  } catch (err) {
    logger.error('[MongoDB-user] Connection error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1); // Optional: fail-fast on DB error
  }
};
