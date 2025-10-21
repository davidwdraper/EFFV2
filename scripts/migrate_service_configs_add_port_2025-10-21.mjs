// migrate_service_configs_add_port_2025-10-21.mjs
// Purpose (service_configs only, idempotent):
//  - Add `port` (number|null) parsed from baseUrl
//  - Remove legacy/unused fields
//  - Touch updatedAt
//  - Keep validator lenient during rollout
//
// Fields removed: allowProxy, configRevision, policy, protectedGetPrefixes, publicPrefixes, etag, __v

(function () {
  const COL_NAME = "service_configs";
  const COL = db.getCollection(COL_NAME);

  // --- 0) Backup ---
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14); // yyyymmddhhmmss
  const BACKUP_NAME = `${COL_NAME}_backup_${ts}`;
  const BACKUP = db.getCollection(BACKUP_NAME);

  print(`[info] Backing up ${COL_NAME} -> ${BACKUP_NAME} ...`);
  BACKUP.insertMany(COL.find().toArray());
  print(`[ok] Backup count: ${BACKUP.countDocuments()}`);

  // --- 1) Helpers ---
  function parsePort(baseUrl) {
    if (!baseUrl || typeof baseUrl !== "string") return null;
    try {
      // Ensure scheme so URL() can parse. We don't assert correctness here—null if not explicit.
      const needsScheme = !/^https?:\/\//i.test(baseUrl);
      const u = new URL(needsScheme ? `http://${baseUrl}` : baseUrl);
      if (!u.port) return null;
      const n = Number(u.port);
      return Number.isFinite(n) ? n : null;
    } catch (_e) {
      return null; // unparseable -> null, we'll warn
    }
  }

  const FIELDS_TO_UNSET = [
    "allowProxy",
    "configRevision",
    "policy",
    "protectedGetPrefixes",
    "publicPrefixes",
    "etag",
    "__v",
  ];

  // --- 2) Scan + update ---
  const cur = COL.find({});
  let updated = 0;
  let parseWarnings = 0;
  let missingBooleans = 0;
  let removedJunkCount = 0;

  while (cur.hasNext()) {
    const doc = cur.next();

    const port = parsePort(doc.baseUrl);
    if (port === null && typeof doc.baseUrl === "string") parseWarnings++;

    const unset = {};
    let removedAny = false;
    for (const k of FIELDS_TO_UNSET) {
      if (k in doc) {
        unset[k] = "";
        removedAny = true;
      }
    }
    if (removedAny) removedJunkCount++;

    const set = { updatedAt: new Date().toISOString() };
    if (doc.port !== port) set.port = port;

    // Report missing booleans (don’t invent defaults)
    for (const k of ["enabled", "internalOnly", "exposeHealth"]) {
      if (!(k in doc)) missingBooleans++;
    }

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    if (Object.keys(update).length) {
      COL.updateOne({ _id: doc._id }, update);
      updated++;
    }
  }

  print(`[ok] Updated docs: ${updated}`);
  if (removedJunkCount > 0)
    print(
      `[ok] Removed legacy fields from ${removedJunkCount} doc(s): ${FIELDS_TO_UNSET.join(
        ", "
      )}`
    );
  if (parseWarnings > 0)
    print(
      `[warn] ${parseWarnings} doc(s) had baseUrl without explicit port or failed to parse; port=null`
    );
  if (missingBooleans > 0)
    print(
      `[warn] ${missingBooleans} boolean field(s) missing across docs (enabled/internalOnly/exposeHealth). No defaults applied.`
    );

  // --- 3) Validator update (lenient) ---
  print(`[info] Updating validator to allow 'port' (number|null) ...`);
  const collMod = db.runCommand({
    collMod: COL_NAME,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["slug", "version", "baseUrl"],
        properties: {
          slug: { bsonType: "string" },
          version: { bsonType: ["int", "long", "double"] }, // tolerate existing types
          baseUrl: { bsonType: "string" },
          port: { bsonType: ["int", "long", "null"] },
          enabled: { bsonType: ["bool"] },
          internalOnly: { bsonType: ["bool"] },
          exposeHealth: { bsonType: ["bool"] },
          updatedAt: { bsonType: "string" },
        },
        additionalProperties: true, // loosened for rollout; tighten later if desired
      },
    },
  });
  if (collMod.ok !== 1) {
    printjson(collMod);
    throw new Error("Validator update failed.");
  }
  print(`[ok] Validator updated.`);

  // --- 4) Quick sanity checks ---
  print(`[info] Sanity checks...`);
  const leftovers = COL.countDocuments({
    $or: FIELDS_TO_UNSET.map((k) => ({ [k]: { $exists: true } })),
  });
  print(
    leftovers === 0
      ? "[ok] No leftover legacy fields."
      : `[warn] ${leftovers} doc(s) still have legacy fields (unexpected).`
  );

  // Show a tiny sample
  const sample = COL.find(
    {},
    {
      _id: 1,
      slug: 1,
      version: 1,
      baseUrl: 1,
      port: 1,
      enabled: 1,
      internalOnly: 1,
      exposeHealth: 1,
    }
  )
    .limit(5)
    .toArray();
  print(`[info] Sample (first 5):`);
  printjson(sample);

  print("[done] service_configs migration complete.");
})();
