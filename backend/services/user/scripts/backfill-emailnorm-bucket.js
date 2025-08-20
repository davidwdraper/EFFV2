// backend/services/user/scripts/backfill-emailnorm-bucket.js
/* repo: backend/services/user/scripts/backfill-emailnorm-bucket.js */
const path = require("path");
const dotenv = require("dotenv");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const fs = require("fs");

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

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env: ${name}`);
  return v.trim();
}
function requireNumber(name) {
  const v = requireEnv(name);
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Env ${name} must be a positive integer, got: ${v}`);
  }
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
  const uri = requireEnv("USER_MONGO_URI");
  const client = new MongoClient(uri);
  await client.connect();

  // Use default DB from URI
  const db = client.db();
  const users = db.collection("users"); // same collection name Mongoose uses for model "User"

  // Find docs missing either field, or with uppercase emails to re-normalize
  const cursor = users.find(
    {
      $or: [
        { emailNorm: { $exists: false } },
        { bucket: { $exists: false } },
        { email: { $regex: /[A-Z]/ } },
      ],
    },
    { projection: { _id: 1, email: 1, emailNorm: 1, bucket: 1 } }
  );

  let n = 0,
    updated = 0,
    errors = 0;
  while (await cursor.hasNext()) {
    const u = await cursor.next();
    n++;
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
      // If you have true dupes differing only by case, this may throw (email unique index).
      // Note them so you can resolve manually.
      console.error(
        `[backfill] failed for _id=${u._id}: ${(e && e.message) || e}`
      );
      errors++;
    }

    if (n % 1000 === 0)
      console.log(`scanned ${n}… updated ${updated}, errors ${errors}`);
  }

  console.log(`done. scanned=${n}, updated=${updated}, errors=${errors}`);
  await client.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
