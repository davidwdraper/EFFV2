import dotenv from 'dotenv';
import path from 'path';

// ✅ Replace with absolute path to project root
const env = process.env.NODE_ENV || 'dev';
const envPath = path.resolve(__dirname, '../../../.env.' + env);
dotenv.config({ path: envPath });

console.log(`[Orchestrator config] loading env from: ${envPath}`);
console.log(`[Orchestrator config] ORCHESTRATOR_PORT is: ${process.env.ORCHESTRATOR_PORT}`);

export const config = {
  env,
  port: parseInt(process.env.ORCHESTRATOR_PORT || '8888', 10),
  jwtSecret: process.env.JWT_SECRET || '2468',
  logLevel: process.env.LOG_LEVEL || 'info',
};
