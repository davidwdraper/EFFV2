// PATH: backend/services/svcconfig/src/seeds/seed.ts
/**
 * NowVibin — svcconfig seeder (idempotent, versioned)
 * Why:
 * - Seed essential svcconfig entries so the gateway can resolve workers.
 * - Store version as NUMBER (1). Never "v1"/"V1".
 * - Bulk upsert by (slug, version) and print before/after counts for sanity.
 *
 * Notes:
 * - No shared imports, no aliases, no barrels. Runs fine via ts-node.
 * - Keep Mongo connect helpers local to avoid cross-package bootstrap issues.
 */

import "dotenv/config";
import mongoose from "mongoose";
import SvcService from "../models/svcconfig.model";

// ──────────────────────────────────────────────────────────────────────────────
// Local DB helpers (declare state BEFORE use to avoid TDZ)
// ──────────────────────────────────────────────────────────────────────────────
let connected = false;

/** Connect to Mongo once (explicit URI, predictable behavior). */
export async function connectDb(uri: string): Promise<void> {
  if (connected) return;

  // Fail fast if no URI
  if (!uri) throw new Error("[svcconfig:seed] Missing Mongo URI");

  // Surface errors immediately; avoid buffering surprises
  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);

  await mongoose.connect(uri).catch((err) => {
    console.log({ err }, "[svcconfig:seed] mongoose.connect failed");
    throw err;
  });

  // Ensure ready (1 = connected)
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise();
  }

  connected = true;
  console.log("[svcconfig:seed] Mongo connected");
}

/** Disconnect politely; safe to call even if never connected. */
export async function disconnectDb(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("[svcconfig:seed] Mongo disconnected");
    }
  } finally {
    connected = false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Explicit service bases (no guessing)
// ──────────────────────────────────────────────────────────────────────────────
const USER_BASE_URL = "http://127.0.0.1:4001";
const ACT_BASE_URL = "http://127.0.0.1:4002";
const AUDIT_BASE_URL = "http://127.0.0.1:4015";
const LOG_BASE_URL = "http://127.0.0.1:4006";
const GEO_BASE_URL = "http://127.0.0.1:4012";
const AUTH_BASE_URL = "http://127.0.0.1:4007";

// Local Mongo URI for this seeder (override here if you must)
const MONGO_URI = "mongodb://127.0.0.1:27017/eff_svcconfig_db";

// ──────────────────────────────────────────────────────────────────────────────
// Seeder
// ──────────────────────────────────────────────────────────────────────────────
async function run() {
  // 1) Connect
  await connectDb(MONGO_URI);

  // Print where we actually are
  const dbName = mongoose.connection.db.databaseName;
  const collName =
    (SvcService as any).collection?.name || "(unknown-collection)";
  console.log(`[seed] connected to db="${dbName}" collection="${collName}"`);

  // 2) Build items
  const V1 = 1;
  const items = [
    {
      slug: "user",
      version: V1,
      enabled: true,
      allowProxy: true,
      baseUrl: USER_BASE_URL,
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: ["/users/email", "/users/private"],
      publicPrefixes: ["/users/search"],
      overrides: { timeoutMs: 5000 },
      updatedBy: "seed",
      notes: "User service",
    },
    {
      slug: "auth",
      version: V1,
      enabled: true,
      allowProxy: true,
      baseUrl: AUTH_BASE_URL,
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: [],
      overrides: { timeoutMs: 5000 },
      updatedBy: "seed",
      notes: "Auth service",
    },
    {
      slug: "act",
      version: V1,
      enabled: true,
      allowProxy: true,
      baseUrl: ACT_BASE_URL,
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: ["/acts/search", "/acts/by-hometown"],
      overrides: { timeoutMs: 5000 },
      updatedBy: "seed",
      notes: "Act service",
    },
    {
      slug: "geo",
      version: V1,
      enabled: true,
      allowProxy: true,
      baseUrl: GEO_BASE_URL,
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: ["/geo/resolve"],
      overrides: { timeoutMs: 5000 },
      updatedBy: "seed",
      notes: "Geo service",
    },
    // Gateway essentials
    {
      slug: "audit",
      version: V1,
      enabled: true,
      allowProxy: true,
      baseUrl: AUDIT_BASE_URL,
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: [],
      overrides: { timeoutMs: 5000 },
      updatedBy: "seed",
      notes: "Audit service (required by gateway WAL)",
    },
    {
      slug: "log",
      version: V1,
      enabled: true,
      allowProxy: true,
      baseUrl: LOG_BASE_URL,
      outboundApiPrefix: "/api",
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: [],
      overrides: { timeoutMs: 5000 },
      updatedBy: "seed",
      notes: "Log service (required by gateway telemetry)",
    },
  ];

  // 3) Before count
  const before = await SvcService.countDocuments({});
  console.log(`[seed] before count=${before}`);

  // 4) Bulk upsert by (slug, version)
  const ops = items.map((it) => ({
    updateOne: {
      filter: { slug: it.slug, version: it.version },
      update: {
        $set: { ...it, updatedAt: new Date(), updatedBy: "seed" },
        $setOnInsert: { createdAt: new Date() },
      },
      upsert: true,
    },
  }));

  const res = await SvcService.bulkWrite(ops as any, { ordered: false });
  const summary = {
    ok: (res as any).ok ?? 1,
    nUpserted:
      (res as any).nUpserted ??
      Object.keys((res as any).upserted || {}).length ??
      0,
    nMatched: (res as any).nMatched ?? 0,
    nModified: (res as any).nModified ?? 0,
  };
  console.log("[seed] bulk result:", JSON.stringify(summary));

  // 5) After count
  const after = await SvcService.countDocuments({});
  console.log(`[seed] after count=${after} (delta=${after - before})`);

  // 6) Print present entries (sanity)
  const docs = await SvcService.find({
    slug: { $in: items.map((i) => i.slug) },
    version: V1,
  })
    .select({ slug: 1, version: 1, baseUrl: 1, enabled: 1, _id: 0 })
    .lean();

  console.log("[seed] present entries:", JSON.stringify(docs, null, 2));
}

// Top-level invoke
run()
  .then(disconnectDb)
  .catch(async (err) => {
    console.error(err);
    try {
      await disconnectDb();
    } catch {}
    process.exit(1);
  });
