// src/db.ts
import mongoose from "mongoose";
import { config } from "./config";
import { logger } from "@eff/shared/src/utils/logger";

export const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    console.info("[MongoDB-log] Connected");
  } catch (err) {
    console.error("[MongoDB-log] Connection error", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1); // Optional: fail-fast on DB error
  }
};
