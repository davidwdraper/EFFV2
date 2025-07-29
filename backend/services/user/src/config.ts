import dotenv from 'dotenv';
import path from 'path';

// Determine current environment (default to development)
const env = process.env.NODE_ENV || 'development';

// Dynamically load the correct .env file (.env.local, .env.docker, etc.)
const envPath = path.resolve(__dirname, `../../../.env.${env}`);
dotenv.config({ path: envPath });

// Export service-specific and shared config values
export const config = {
  env,
  port: parseInt(process.env.ACT_PORT || '4001', 10),
  mongoUri: process.env.ACT_MONGO_URI || 'mongodb://localhost:27017/eff_user_db',
  jwtSecret: process.env.JWT_SECRET || '2468',
  logLevel: process.env.LOG_LEVEL || 'info',
};
