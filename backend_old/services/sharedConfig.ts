import dotenv from 'dotenv';
dotenv.config();

export const sharedConfig = {
  jwtSecret: process.env.JWT_SECRET || '2468',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
};
