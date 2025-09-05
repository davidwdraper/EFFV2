// backend/services/svcconfig/src/seeds/seed.ts
import "../../src/bootstrap";
import mongoose from "mongoose";
import SvcService from "../models/svcconfig.model";
// ⬇️ add this import
import { connectDb, disconnectDb } from "../db";

// Robust logger (prefer shared; fall back to console)
type LoggerLike = {
  info: (...a: any[]) => void;
  warn: (...a: any[]) => void;
  error: (...a: any[]) => void;
};
let logger: LoggerLike = console as any;
try {
  ({ logger } = require("@shared/utils/logger"));
} catch {
  console.warn(
    "[svcconfig:seed] @shared/utils/logger not available; using console"
  );
}

async function run() {
  // ⬇️ open Mongo before doing anything
  await connectDb();

  const items = [
    {
      slug: "user",
      enabled: true,
      allowProxy: true,
      baseUrl: "http://127.0.0.1:4001",
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: ["/users/email", "/users/private"],
      publicPrefixes: ["/users/search"],
      overrides: { timeoutMs: 5000 },
      version: 1,
      updatedBy: "seed",
      notes: "User service",
    },
    {
      slug: "act",
      enabled: true,
      allowProxy: true,
      baseUrl: "http://127.0.0.1:4002",
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: ["/acts/search", "/acts/by-hometown"],
      overrides: { timeoutMs: 5000 },
      version: 1,
      updatedBy: "seed",
      notes: "Act service",
    },
    {
      slug: "gateway-core",
      enabled: true,
      allowProxy: true,
      baseUrl: "http://127.0.0.1:4011",
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: [],
      overrides: { timeoutMs: 5000 },
      version: 1,
      updatedBy: "seed",
      notes: "Core internal router",
    },
    // add geo/log/image/etc. as needed …
  ];

  for (const it of items) {
    await SvcService.updateOne(
      { slug: it.slug },
      { $set: it },
      { upsert: true }
    );
  }

  logger.info({ count: items.length }, "[svcconfig:seed] upserted");
}

run()
  .then(async () => {
    await disconnectDb();
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await disconnectDb();
    } catch {}
    process.exit(1);
  });
