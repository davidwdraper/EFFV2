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
  port: process.env.AUTH_PORT || 4007,
  jwtSecret: process.env.JWT_SECRET || '2468',
  mongoUri: process.env.MONGO_URI || 'mongodb://mongo:27017/eff_user_db',
  orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://orchestrator-core:4011',
  nodeEnv: process.env.NODE_ENV || 'development',
};
