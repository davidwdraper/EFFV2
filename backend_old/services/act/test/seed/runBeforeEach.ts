// backend/services/act/test/seed/runBeforeEach.ts
import { beforeAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

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
    console.warn(
      "[test-seed] ACT_MONGO_URI is not set; cannot connect for seeding."
    );
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

/**
 * Verify that NVTEST_* towns exist.
 * DO NOT write to towns — towns are static, loaded manually out-of-band.
 * If missing, we log a warning so failures are obvious, but we don't mutate.
 */
async function verifyNvTestTownsPresent() {
  if (process.env.NODE_ENV !== "test") return;
  const connected = await ensureConnected();
  if (!connected) return;

  const uri = process.env.ACT_MONGO_URI!;
  const dbName = dbNameFromUri(uri);
  const towns = mongoose.connection.db.collection("towns");

  const preCount = await towns.countDocuments({
    name: { $regex: new RegExp(`^${NV_PREFIX}`) },
  });
  // eslint-disable-next-line no-console
  console.log(`[test-seed] NVTEST_* towns in ${dbName}: ${preCount}`);

  if (preCount === 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[test-seed] No NVTEST_* towns found. Towns are read-only and must be preloaded into the test DB."
    );
  }
}

/**
 * Ensure two guaranteed Act matches for typeahead tests.
 * Uses raw upserts to avoid model imports; idempotent by name.
 */
async function ensureZetaActs() {
  const connected = await ensureConnected();
  if (!connected) return;

  const acts = mongoose.connection.db.collection("acts");
  const now = new Date();

  // Helper to upsert by name
  async function upsertByName(name: string) {
    await acts.updateOne(
      { name },
      {
        $setOnInsert: {
          // minimal required shape consistent with your Act schema
          name,
          dateCreated: now,
          dateLastUpdated: now,
          actStatus: 0, // visible
          actType: [1], // arbitrary valid type
          userCreateId: randomUUID(),
          userOwnerId: randomUUID(),
          eMailAddr: "seed@nv.test",
          imageIds: [],
        },
        $set: {
          dateLastUpdated: now,
        },
      },
      { upsert: true }
    );
  }

  await upsertByName("Zeta Alpha");
  await upsertByName("Zeta Beta");

  // Debug assurance: prove seeds exist post-cleanup
  const zetaCount = await acts.countDocuments({ name: { $regex: /^Zeta / } });
  // eslint-disable-next-line no-console
  console.log(`[test-seed] Zeta acts present: ${zetaCount}`);
}

beforeAll(async () => {
  try {
    await verifyNvTestTownsPresent();
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("[test-seed] Towns verification skipped:", e?.message || e);
  }
});

// After each cleanup (defined in setup.ts), re-upsert Zeta acts so typeahead always finds matches
beforeEach(async () => {
  try {
    await ensureZetaActs();
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn("[test-seed] ensureZetaActs skipped:", e?.message || e);
  }
});
