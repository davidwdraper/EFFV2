// backend/services/act/src/db.ts
import mongoose from "mongoose";
import { config } from "./config";
import { logger } from "@shared/utils/logger";

export const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    logger.info(
      {
        component: "mongodb",
        uri: config.mongoUri.replace(/:\/\/.*@/, "://***:***@"),
      },
      "[MongoDB-act] Connected"
    );
  } catch (err) {
    logger.error(
      {
        component: "mongodb",
        error: err instanceof Error ? err.message : String(err),
      },
      "[MongoDB-act] Connection error"
    );
    process.exit(1); // fail-fast on DB error (adjust if you prefer retry logic)
  }
};
