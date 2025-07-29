import dotenv from 'dotenv';
import path from 'path';

// Determine current environment
const env = process.env.NODE_ENV || 'development';

// Load the correct .env file based on NODE_ENV
const envPath = path.resolve(__dirname, `../../../.env.${env}`);
dotenv.config({ path: envPath });

// Export orchestrator-specific and shared config values
export const config = {
  env,
  port: parseInt(process.env.ORCHESTRATOR_PORT || '4000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: process.env.JWT_SECRET || '2468',
};
