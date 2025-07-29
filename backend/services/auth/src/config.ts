import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.AUTH_PORT || 4006,
  jwtSecret: process.env.JWT_SECRET || '2468',
  mongoUri: process.env.MONGO_URI || 'mongodb://mongo:27017/eff_user_db',
  orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://orchestrator-core:3002',
  nodeEnv: process.env.NODE_ENV || 'development',
};
