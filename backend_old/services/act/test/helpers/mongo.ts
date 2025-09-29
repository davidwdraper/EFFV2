// backend/services/act/test/helpers/mongo.ts
import mongoose from "mongoose";

/**
 * Optional helper if you want per-run DBs:
 *  mongodb://127.0.0.1:27017/eff_act_db -> eff_act_db_NVTEST_<ts>_<pid>
 */
export function resolvePerRunUri(baseUri: string) {
  const runId = `NVTEST_${Date.now()}_${process.pid}`;
  return baseUri.replace(/\/([^/?]+)$/, (_m, db) => `/${db}_${runId}`);
}

/** ---- Internal wait ---- */
async function waitForReady(ms = 10_000) {
  const start = Date.now();
  while (mongoose.connection.readyState !== 1) {
    if (Date.now() - start > ms) throw new Error("Mongo not ready");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** ---- Legacy name (kept) ---- */
export async function connectTestMongo() {
  const uri = process.env.ACT_MONGO_URI!;
  if (!uri) throw new Error("ACT_MONGO_URI missing in test env");
  if (mongoose.connection.readyState === 1) return; // already connected
  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { autoIndex: true });
  await waitForReady();
}

/** ---- New name used by setup.ts ---- */
export async function ensureConnected(uri?: string, opts: any = {}) {
  const _uri = uri || process.env.ACT_MONGO_URI!;
  if (!_uri) throw new Error("ACT_MONGO_URI missing in test env");
  if (mongoose.connection.readyState === 1) return;
  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);
  await mongoose.connect(_uri, { autoIndex: true, ...opts });
  await waitForReady();
}

/** ---- Clean ONLY mutable collections; preserve reference data ---- */
export async function cleanMutableCollections(options?: {
  immutable?: string[];
}) {
  if (mongoose.connection.readyState !== 1) return;

  const db = mongoose.connection.db;
  const collInfos = await db.listCollections().toArray();

  // By default, protect Towns (collection name is typically 'towns')
  const immutable = new Set(
    (options?.immutable ?? ["towns"]).map((n) => n.toLowerCase())
  );

  for (const info of collInfos) {
    const name = info.name;
    if (name.startsWith("system.")) continue;
    if (immutable.has(name.toLowerCase())) continue;
    await db.collection(name).deleteMany({});
  }
}

/** ---- Legacy full drop (kept for compatibility; avoid in new tests) ---- */
export async function dropDb() {
  if (mongoose.connection.readyState !== 1) return;
  await mongoose.connection.db.dropDatabase();
}

/** ---- Disconnect (legacy name kept) ---- */
export async function disconnectTestMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/** ---- New alias for clarity in setup.ts ---- */
export async function disconnectMongo() {
  await disconnectTestMongo();
}

/** ---- Default export for accidental default-imports ---- */
export default {
  resolvePerRunUri,
  connectTestMongo,
  ensureConnected,
  cleanMutableCollections,
  dropDb,
  disconnectTestMongo,
  disconnectMongo,
};
