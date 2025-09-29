// backend/services/log/test/helpers/mongo.ts
import mongoose from "mongoose";

export async function ensureConnected(): Promise<void> {
  // Your service likely reads LOG_MONGO_URI internally; set it here for completeness
  process.env.LOG_MONGO_URI ||= "mongodb://127.0.0.1:27017/eff_log_test";
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.LOG_MONGO_URI!, {
    serverSelectionTimeoutMS: 4000,
  } as any);
}

export async function clearDatabase(): Promise<void> {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

export async function disconnect(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
