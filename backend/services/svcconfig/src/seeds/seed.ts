// backend/services/svcconfig/src/seeds/seed.ts
import "../../src/bootstrap";
import mongoose from "mongoose";
import SvcService from "../models/svcconfig.model";
import { logger } from "@shared/utils/logger";

async function run() {
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
      notes: "Core mini-orchestrator",
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
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
  });
