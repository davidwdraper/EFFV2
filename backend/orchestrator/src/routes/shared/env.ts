// services/routes/shared/env.ts
import dotenv from 'dotenv';
import path from 'path';

const NODE_ENV = process.env.NODE_ENV || 'dev';  // fallback to dev
const envPath = path.resolve(__dirname, `../../../../../.env.${NODE_ENV}`);

console.log('[env] envPath: ', envPath);

dotenv.config({ path: envPath });
console.log('[env] Loaded keys:', Object.keys(process.env).filter(k => k.includes('JWT')));
console.log('[env] JWT_SECRET:', process.env.JWT_SECRET);

if (!process.env.JWT_SECRET) {
  throw new Error(`[env] JWT_SECRET not found in .env.${NODE_ENV}`);
}

export const JWT_SECRET = process.env.JWT_SECRET!;
