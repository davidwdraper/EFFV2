import mongoose from 'mongoose';
import { config } from './config';

export const connectToDB = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('[MongoDB] connected');
  } catch (err) {
    console.error('[MongoDB] connection error:', err);
    process.exit(1);
  }
};
