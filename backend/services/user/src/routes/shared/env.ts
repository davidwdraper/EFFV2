// routes/shared/env.ts
import dotenv from 'dotenv';
import path from 'path';

const NODE_ENV = process.env.NODE_ENV || 'dev';
const envPath = path.resolve(__dirname, `../../../../../../.env.${NODE_ENV}`);
dotenv.config({ path: envPath });

if (!process.env.JWT_SECRET) {
  throw new Error(`[userService] JWT_SECRET not found in .env.${NODE_ENV}`);
}

export const JWT_SECRET = process.env.JWT_SECRET!;
