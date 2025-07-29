import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 4003,
  mongoUri: process.env.MONGO_URI || 'mongodb://mongo:27017/eff_place_db',
  jwtSecret: process.env.JWT_SECRET || '2468',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
};
