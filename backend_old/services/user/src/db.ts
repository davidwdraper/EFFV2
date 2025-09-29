// backend/services/user/src/db.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *
 * Why:
 * - Keep DB boot for USER identical to ACT (baseline entity service):
 *   • Validate env vars early (no silent fallbacks)
 *   • Disable mongoose buffering so connection errors surface immediately
 *   • Log a redacted URI (no credentials)
 *   • Wait until the connection is actually established before declaring ready
 */

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

  const uri = requireEnv("USER_MONGO_URI");

  // Be explicit; disable buffering so errors surface immediately
  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);

  // Avoid deprecation churn; Mongoose 7+ uses driver defaults
  logger.info(
    { msg: "mongo:connect", uri: redactMongoUri(uri) },
    "[user] connecting to Mongo"
  );

  // Initiate and await actual socket open
  await mongoose.connect(uri).catch((err) => {
    logger.error({ err }, "[user] mongoose.connect failed");
    throw err;
  });

  // Wait until the connection emits 'connected' (readyState === 1)
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise(); // resolves when connected
  }

  connected = true;
  logger.info("[user] Mongo connected");
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
