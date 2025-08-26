// backend/tests/e2e/setup.ts
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "http";
import mongoose from "mongoose";
import { vi, beforeAll, afterAll } from "vitest";

// ── Load envs from a fallback chain (first existing wins) ────────────────
const candidates = [
  process.env.ENV_FILE_E2E, // explicit override
  ".env.test", // ✅ repo root test env
  ".env.dev",
  ".env.docker",
].filter(Boolean) as string[];

for (const p of candidates) {
  const abs = path.resolve(process.cwd(), p);
  if (fs.existsSync(abs)) {
    loadEnv({ path: abs });
    break; // stop at first that exists
  }
}

// ── Required vars: HARD FAIL if missing ──────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    const tried = candidates.join(", ");
    throw new Error(
      `Missing required env var ${name}. Provide it via ENV_FILE_E2E or the shell.\n` +
        `Tried env files: ${tried}\n` +
        `Example:\n  ENV_FILE_E2E=backend/tests/.env.e2e yarn vitest -c backend/tests/vitest.config.e2e.ts`
    );
  }
  return v.trim();
}
function requirePort(name: string): number {
  const v = requireEnv(name);
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n >= 65536) {
    throw new Error(`Invalid ${name}="${v}". Must be 1–65535.`);
  }
  return n;
}

// Satisfy your env enum (dev|docker|production)
process.env.NODE_ENV = "dev";

// Enforce: no defaults — must be set in env file or shell
const ACT_PORT = requirePort("ACT_PORT");
const GATEWAY_PORT = requirePort("GATEWAY_PORT");

// Also needed
const MONGO_URI = requireEnv("ACT_MONGO_URI");

// Quiet logs; force memory cache; block Redis at the source
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";
process.env.CACHE_PROVIDER = process.env.CACHE_PROVIDER || "memory";
process.env.REDIS_DISABLED = "1";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:0";

// ── Test-time mocks to BLOCK any Redis connection attempts ───────────────
vi.mock("redis", () => {
  const client = {
    on: () => {},
    connect: async () => {},
    quit: async () => {},
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    publish: async () => 0,
    subscribe: async () => 0,
    psubscribe: async () => 0,
  };
  return { createClient: () => client };
});
vi.mock("ioredis", () => {
  class Redis {
    constructor() {}
    on() {}
    quit() {
      return Promise.resolve();
    }
    disconnect() {
      return Promise.resolve();
    }
    get() {
      return Promise.resolve(null);
    }
    set() {
      return Promise.resolve("OK");
    }
    del() {
      return Promise.resolve(0);
    }
    publish() {
      return Promise.resolve(0);
    }
    subscribe() {
      return Promise.resolve();
    }
    psubscribe() {
      return Promise.resolve();
    }
    ping() {
      return Promise.resolve("PONG");
    }
  }
  return { default: Redis };
});

// ── Mongoose hygiene ─────────────────────────────────────────────────────
mongoose.set("strictQuery", true);
mongoose.set("bufferCommands", false);

const servers: Server[] = [];

// ── Seed minimal Towns set once (deterministic) ──────────────────────────
async function ensureMongoAndSeedTowns() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(MONGO_URI, { autoIndex: true });
  }
  const Town =
    (mongoose.models as any).Town ??
    (await import("../../services/act/src/models/Town")).default;

  const count = await Town.countDocuments({});
  if (count === 0) {
    const towns = [
      { name: "Austin", state: "TX", lat: 30.2672, lng: -97.7431 },
      { name: "Round Rock", state: "TX", lat: 30.5083, lng: -97.6789 },
      { name: "San Marcos", state: "TX", lat: 29.8833, lng: -97.9414 },
      { name: "Georgetown", state: "TX", lat: 30.6333, lng: -97.6667 },
      { name: "Pflugerville", state: "TX", lat: 30.4394, lng: -97.62 },
    ].map((t) => ({
      ...t,
      loc: { type: "Point", coordinates: [t.lng, t.lat] },
    }));
    await Town.insertMany(towns, { ordered: true });

    // Sanity: ensure geo index exists
    const idx = await Town.collection.indexes();
    const hasGeo = idx.some(
      (i: any) => i.key && i.key.loc && i.key.loc === "2dsphere"
    );
    if (!hasGeo) throw new Error("Missing 2dsphere index on towns.loc");
  }
}

// ── Boot Act service on :ACT_PORT ────────────────────────────────────────
async function startAct() {
  let app: any;
  try {
    ({ default: app } = await import("../../services/act/src/app"));
  } catch {
    const mod = await import("../../services/act/src/app");
    app = (mod as any).app || (mod as any).default;
  }
  if (!app || !app.listen) {
    throw new Error("[E2E] Could not import Act app from services/act/src/app");
  }
  await ensureMongoAndSeedTowns();
  return new Promise<Server>((resolve) => {
    const s = app.listen(ACT_PORT, "127.0.0.1", () => resolve(s));
  });
}

// ── Boot Gateway on :GATEWAY_PORT ────────────────────────────────────────
async function startGateway() {
  const mod: Record<string, any> = await import(
    "../../services/gateway/src/app"
  );
  const app =
    mod.app ??
    mod.default ??
    (typeof mod.createApp === "function" ? mod.createApp() : undefined);

  if (!app || typeof app.listen !== "function") {
    const keys = Object.keys(mod).join(", ");
    throw new Error(
      `[E2E] Gateway app not found. Expected export named 'app', default export, or 'createApp()'. Found exports: ${keys}`
    );
  }

  return new Promise<Server>((resolve) => {
    const s = app.listen(GATEWAY_PORT, "127.0.0.1", () => resolve(s));
  });
}

// ── Vitest global hooks ──────────────────────────────────────────────────
export async function setup() {
  const act = await startAct();
  servers.push(act);

  const gw = await startGateway();
  servers.push(gw);
}

export async function teardown() {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          try {
            s.close(() => resolve());
          } catch {
            resolve();
          }
        })
    )
  );
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

beforeAll(async () => {
  await setup();
});
afterAll(async () => {
  await teardown();
});
