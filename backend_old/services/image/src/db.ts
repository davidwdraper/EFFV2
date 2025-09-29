// backend/services/image/src/db.ts
import mongoose from "mongoose";
import { logger } from "../../shared/utils/logger";
import { config } from "./config";

export const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    logger.info(
      { component: "mongodb", service: config.serviceName },
      "[DB] Connected"
    );
  } catch (err: any) {
    logger.error(
      {
        component: "mongodb",
        service: config.serviceName,
        error: err?.message || String(err),
      },
      "[DB] Connection error"
    );
    process.exit(1); // fail fast on DB connection failure
  }
};
