// backend/services/template/src/db.ts
import mongoose from "mongoose";
import { logger } from "@eff/shared/src/utils/logger";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function redactMongoUri(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.password) u.password = "***";
    if (u.username) u.username = "***";
    return u.toString();
  } catch {
    return uri.replace(/\/\/([^@]+)@/, "//***:***@");
  }
}

let connected = false;

/**
 * Connect to MongoDB using GEO_MONGO_URI.
 * - bufferCommands=false to surface errors immediately
 * - strictQuery=true for predictable query parsing
 */
export async function connectDb(): Promise<void> {
  if (connected) return;

  const uri = requireEnv("GEO_MONGO_URI");

  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);

  logger.info(
    { msg: "mongo:connect", uri: redactMongoUri(uri) },
    "[template] connecting to Mongo"
  );

  try {
    await mongoose.connect(uri);
  } catch (err) {
    logger.error({ err }, "[template] mongoose.connect failed");
    throw err;
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise();
  }

  connected = true;
  logger.info("[template] Mongo connected");
}

export async function disconnectDb(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } finally {
    connected = false;
  }
}
