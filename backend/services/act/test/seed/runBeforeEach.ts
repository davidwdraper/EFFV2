// backend/services/act/test/seed/runBeforeEach.ts
import { beforeAll } from "vitest";
import mongoose from "mongoose";
import Town from "../../src/models/Town";

const NV_PREFIX = "NVTEST_";

function dbNameFromUri(uri: string | undefined) {
  if (!uri) return "(no-uri)";
  try {
    const u = new URL(uri.replace("mongodb://", "http://"));
    return (u.pathname || "/").slice(1) || "(no-db-in-uri)";
  } catch {
    return "(unparsable-uri)";
  }
}

async function ensureConnected(): Promise<boolean> {
  if (mongoose.connection.readyState === 1) return true;

  const uri = process.env.ACT_MONGO_URI;
  if (!uri) {
    // eslint-disable-next-line no-console
    console.warn("[test-seed] ACT_MONGO_URI is not set; cannot seed towns.");
    return false;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 4000 } as any);
    // eslint-disable-next-line no-console
    console.log(`[test-seed] Connected for seeding. db=${dbNameFromUri(uri)}`);
    return true;
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("[test-seed] Failed to connect for seeding:", e?.message || e);
    return false;
  }
}

async function seedNvTestTownsIfMissing() {
  if (process.env.NODE_ENV !== "test") return;

  const connected = await ensureConnected();
  if (!connected) return;

  const uri = process.env.ACT_MONGO_URI;
  const dbName = dbNameFromUri(uri);

  const preCount = await Town.countDocuments({
    name: { $regex: new RegExp(`^${NV_PREFIX}`) },
  });
  // eslint-disable-next-line no-console
  console.log(`[test-seed] Pre-count NVTEST_* towns in ${dbName}: ${preCount}`);

  if (preCount === 0) {
    type Seed = { name: string; state: string; lat: number; lng: number };
    const seeds: Seed[] = [
      { name: "NVTEST_TOWN_Tampa", state: "FL", lat: 27.9506, lng: -82.4572 },
      {
        name: "NVTEST_Tamalpais Valley",
        state: "CA",
        lat: 37.878,
        lng: -122.545,
      },
      { name: "NVTEST_Tamworth", state: "NH", lat: 43.855, lng: -71.286 },
      { name: "NVTEST_Austin", state: "TX", lat: 30.2672, lng: -97.7431 },
      { name: "NVTEST_Albany", state: "NY", lat: 42.6526, lng: -73.7562 },
    ];

    // IMPORTANT: Provide GeoJSON 'loc' with coordinates [lng, lat] to satisfy 2dsphere index
    const docs = seeds.map((s) => ({
      name: s.name,
      state: s.state,
      lat: s.lat,
      lng: s.lng,
      loc: { type: "Point", coordinates: [s.lng, s.lat] },
    }));

    await Town.bulkWrite(
      docs.map((d) => ({
        updateOne: {
          filter: { name: d.name },
          update: { $setOnInsert: d },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  const postCount = await Town.countDocuments({
    name: { $regex: new RegExp(`^${NV_PREFIX}`) },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[test-seed] Post-count NVTEST_* towns in ${dbName}: ${postCount}`
  );
}

beforeAll(async () => {
  try {
    await seedNvTestTownsIfMissing();
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("[test-seed] NVTEST_* towns seed skipped:", e?.message || e);
  }
});
