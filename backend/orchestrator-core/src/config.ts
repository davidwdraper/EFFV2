import dotenv from 'dotenv';
import path from 'path';

const env = process.env.NODE_ENV || 'dev';

// Force load the correct .env.{env} from project root
const envPath = path.resolve(__dirname, '../../../.env.' + env);
dotenv.config({ path: envPath });

console.log(`[config] Loaded: ${envPath}`);
console.log(`[config] ORCHESTRATOR_CORE_PORT = ${process.env.ORCHESTRATOR_CORE_PORT}`);

export const config = {
  env,
  port: parseInt(process.env.ORCHESTRATOR_CORE_PORT || '4011', 10),
  //mongoUri: process.env.ORCHESTRATOR_CORE_MONGO_URI || 'mongodb://localhost:27017/eff_orchestrator_core_db',
  authEnabled: process.env.AUTH_ENABLED !== 'false',
  eventServiceUrl: process.env.EVENT_SERVICE_URL || 'http://localhost:4003',
  placeServiceUrl: process.env.PLACE_SERVICE_URL || 'http://localhost:4004',
  logLevel: process.env.LOG_LEVEL || 'info',
};
