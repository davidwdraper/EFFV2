// backend/services/user/scripts/backfill-emailnorm-bucket.js
/* repo path: backend/services/user/scripts/backfill-emailnorm-bucket.js */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

// Load env from repo root (or set ENV_FILE)
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
const resolved = path.resolve(__dirname, "../../../../", envFile);
if (!fs.existsSync(resolved)) {
  throw new Error(
    `[env] Not found: ${resolved} — set ENV_FILE or place .env.dev at repo root`
  );
}
console.log(`[env] Loading: ${resolved}`);
dotenv.config({ path: resolved });

// Helpers
function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env: ${name}`);
  return v.trim();
}
function requireNumber(name) {
  const n = Number(requireEnv(name));
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`Env ${name} must be a positive integer, got: ${n}`);
  return n;
}
const USER_BUCKETS = requireNumber("USER_BUCKETS");
function normalizeEmail(e) {
  return String(e || "")
    .trim()
    .toLowerCase();
}
function emailToBucket(email) {
  const hex = crypto
    .createHash("sha1")
    .update(normalizeEmail(email))
    .digest("hex");
  const n = parseInt(hex.slice(0, 8), 16) >>> 0;
  return n % USER_BUCKETS;
}

(async function main() {
  const uri = requireEnv("USER_MONGO_URI"); // include a DB name in URI
  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db(); // from URI
  const users = db.collection("users"); // Mongoose model "User" => "users"

  const cursor = users.find(
    {
      $or: [
        { emailNorm: { $exists: false } },
        { bucket: { $exists: false } },
        { email: { $regex: /[A-Z]/ } }, // re-normalize stray uppercase
      ],
    },
    { projection: { _id: 1, email: 1, emailNorm: 1, bucket: 1 } }
  );

  let scanned = 0,
    updated = 0,
    errors = 0;
  while (await cursor.hasNext()) {
    const u = await cursor.next();
    scanned++;
    const norm = normalizeEmail(u.email);
    const bucket = emailToBucket(norm);

    const set = { email: norm };
    if (u.emailNorm !== norm) set.emailNorm = norm;
    if (u.bucket !== bucket) set.bucket = bucket;

    try {
      if (Object.keys(set).length) {
        await users.updateOne({ _id: u._id }, { $set: set });
        updated++;
      }
    } catch (e) {
      console.error(`[backfill] _id=${u._id}: ${(e && e.message) || e}`);
      errors++;
    }

    if (scanned % 1000 === 0)
      console.log(`scanned ${scanned}… updated ${updated}, errors ${errors}`);
  }

  console.log(`done. scanned=${scanned}, updated=${updated}, errors=${errors}`);
  await client.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
