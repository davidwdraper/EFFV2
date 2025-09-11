// backend/services/svcconfig/src/db.ts

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

export async function connectDb(): Promise<void> {
  if (connected) return;

  const uri = requireEnv("SVCCONFIG_MONGO_URI");

  // Be explicit; disable buffering so errors surface immediately
  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);

  logger.info(
    { msg: "mongo:connect", uri: redactMongoUri(uri) },
    "[svcconfig] connecting to Mongo"
  );

  await mongoose.connect(uri).catch((err) => {
    logger.error({ err }, "[svcconfig] mongoose.connect failed");
    throw err;
  });

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise();
  }

  connected = true;
  logger.info("[svcconfig] Mongo connected");
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
