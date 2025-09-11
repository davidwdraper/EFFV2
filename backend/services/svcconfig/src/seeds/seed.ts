// backend/services/svcconfig/src/seeds/seed.ts
import "../bootstrap.ts.old";
import mongoose from "mongoose";
import axios from "axios";
import SvcService from "../models/svcconfig.model";
// ⬇️ open/close DB via shared helpers
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

// ──────────────────────────────────────────────────────────────────────────────
// Broadcast helpers (Redis first; HTTP fallback to svcconfig /broadcast)
async function broadcastInvalidation(slug = "all") {
  const channel = process.env.SVCCONFIG_CHANNEL || "svcconfig:changed";
  const redisUrl = process.env.REDIS_URL || "";
  if (redisUrl) {
    try {
      const { createClient } = await import("redis");
      const pub = createClient({ url: redisUrl });
      await pub.connect();
      await pub.publish(channel, slug);
      await pub.quit();
      logger.info({ channel, slug }, "[svcconfig:seed] redis publish");
      return;
    } catch (e: any) {
      logger.warn(
        { err: e?.message },
        "[svcconfig:seed] redis publish failed; will try HTTP"
      );
    }
  }

  const base = process.env.SVCCONFIG_BASE_URL || "http://127.0.0.1:4013";
  try {
    await axios.post(
      `${base.replace(/\/+$/, "")}/api/svcconfig/broadcast`,
      { slug },
      { timeout: 2500 }
    );
    logger.info({ base, slug }, "[svcconfig:seed] http broadcast");
  } catch (e: any) {
    logger.warn({ err: e?.message }, "[svcconfig:seed] http broadcast failed");
  }
}

// ──────────────────────────────────────────────────────────────────────────────

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
    {
      slug: "geo",
      enabled: true,
      allowProxy: true,
      baseUrl: "http://127.0.0.1:4012",
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: ["/geo/resolve"],
      overrides: { timeoutMs: 5000 },
      version: 1,
      updatedBy: "seed",
      notes: "Geo service",
    },

    // add user/image/etc. as needed …
  ];

  // ⬇️ idempotent upserts keyed by slug
  for (const it of items) {
    await SvcService.updateOne(
      { slug: it.slug },
      { $set: it },
      { upsert: true }
    );
  }

  logger.info({ count: items.length }, "[svcconfig:seed] upserted");

  // ⬇️ trigger cache invalidation so gateways refresh without restart
  await broadcastInvalidation("all");
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
