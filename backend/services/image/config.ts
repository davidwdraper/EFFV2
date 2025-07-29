import dotenv from 'dotenv';
import path from 'path';

const env = process.env.NODE_ENV || 'development';
const envPath = path.resolve(__dirname, `../../../.env.${env}`);
dotenv.config({ path: envPath });

export const config = {
  env,
  port: parseInt(process.env.IMAGE_PORT || '4005', 10),
  mongoUri: process.env.IMAGE_MONGO_URI || 'mongodb://localhost:27017/image',
  logLevel: process.env.LOG_LEVEL || 'info',
};
