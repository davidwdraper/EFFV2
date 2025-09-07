// backend/services/--template--/src/db.ts
import mongoose from "mongoose";
import { logger } from "@shared/utils/logger";

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

export async function connectDb(): Promise<void> {
  if (connected) return;

  const uri = requireEnv("TEMPLATE_MONGO_URI");

  // Be explicit; disable buffering so errors surface immediately
  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);

  // Avoid deprecation churn; Mongoose 7+ uses driver defaults
  logger.info(
    { msg: "mongo:connect", uri: redactMongoUri(uri) },
    "[template] connecting to Mongo"
  );

  // Initiate and await actual socket open
  await mongoose.connect(uri).catch((err) => {
    logger.error({ err }, "[template] mongoose.connect failed");
    throw err;
  });

  // Wait until the connection emits 'connected' (readyState === 1)
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise(); // resolves when connected
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
