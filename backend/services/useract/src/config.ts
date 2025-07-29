import dotenv from 'dotenv';
import path from 'path';

// ✅ Replace with absolute path to project root
const env = process.env.NODE_ENV || 'dev';
const envPath = path.resolve(__dirname, '../../../../.env.' + env);
dotenv.config({ path: envPath });

console.log(`[UserAct config] loading env from: ${envPath}`);
console.log(`[UserAct config] USERACT_PORT is: ${process.env.USERACT_PORT}`);

export const config = {
  env,
  port: parseInt(process.env.USERACT_PORT || '8888', 10),
  mongoUri: process.env.ACT_MONGO_URI || 'mongodb://localhost:27017/eff_useract_db',
  jwtSecret: process.env.JWT_SECRET || '2468',
  logLevel: process.env.LOG_LEVEL || 'info',
};