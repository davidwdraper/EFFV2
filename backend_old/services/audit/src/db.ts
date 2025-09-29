// backend/services/audit/src/db.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/db.ts
 * Service Slug: audit
 *
 * Why:
 *   - Validate env early (no silent fallbacks).
 *   - Disable mongoose buffering so connection errors surface immediately.
 *   - Redact credentials when logging the URI.
 *   - Wait until readyState === 1 before declaring connected.
 *   - Ensure indexes (esp. unique eventId) are in place on boot.
 */

import mongoose from "mongoose";
import { logger } from "@eff/shared/src/utils/logger";
import AuditEventModel from "./models/auditEvent.model";

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

  const uri = requireEnv("AUDIT_MONGO_URI");

  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);

  logger.info(
    { msg: "mongo:connect", uri: redactMongoUri(uri) },
    "[audit] connecting to Mongo"
  );

  try {
    await mongoose.connect(uri);
  } catch (err) {
    logger.error({ err }, "[audit] mongoose.connect failed");
    throw err;
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise();
  }

  connected = true;
  logger.info("[audit] Mongo connected");

  // Ensure indexes exist (esp. unique eventId). Idempotent; safe each boot.
  try {
    await AuditEventModel.syncIndexes();
    logger.info("[audit] Mongo indexes synced");
  } catch (err) {
    logger.error({ err }, "[audit] syncIndexes failed");
    throw err;
  }
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
