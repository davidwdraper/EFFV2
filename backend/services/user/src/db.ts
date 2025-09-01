// backend/services/user/src/db.ts
import mongoose from "mongoose";
import { logger } from "@shared/utils/logger";
import { config } from "./config";
import { SERVICE_NAME } from "./bootstrap";

mongoose.set("strictQuery", true); // SOP: consistent queries

export async function connectDb(uri: string = config.mongoUri) {
  logger.debug({ service: SERVICE_NAME, uri }, "[db] connecting");

  const conn = mongoose.connection;

  // Connection telemetry
  conn.on("connected", () => {
    logger.info({ service: SERVICE_NAME }, "[db] connected");
  });
  conn.on("error", (err) => {
    logger.error({ service: SERVICE_NAME, err }, "[db] error");
  });
  conn.on("disconnected", () => {
    logger.warn({ service: SERVICE_NAME }, "[db] disconnected");
  });
  // Some drivers emit "reconnected" but typings may not include it; cast once.
  (conn as any).on("reconnected", () => {
    logger.info({ service: SERVICE_NAME }, "[db] reconnected");
  });

  await mongoose.connect(uri);

  logger.debug({ service: SERVICE_NAME }, "[db] connect resolved");
  return mongoose;
}
