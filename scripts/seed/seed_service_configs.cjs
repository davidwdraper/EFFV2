// scripts/seed/seed_service_configs.cjs
/* Fail-fast seeder for service_configs (eff_svcconfig_db) with loud logs */
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/eff_svcconfig_db";
const DB_NAME = "eff_svcconfig_db";

const SvcConfigSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    enabled: { type: Boolean, required: true },
    allowProxy: { type: Boolean, required: true },
    baseUrl: { type: String, required: true },
    outboundApiPrefix: { type: String, required: true },
    configRevision: { type: Number, required: true },
    policy: { type: Object, required: true },
    etag: { type: String, required: true, index: true },
    healthPath: { type: String, default: "/health" },
    exposeHealth: { type: Boolean, default: true },
    protectedGetPrefixes: { type: [String], default: [] },
    publicPrefixes: { type: [String], default: [] },
    overrides: { type: Object },
    updatedAt: { type: Date, required: true, default: () => new Date() },
    updatedBy: { type: String, required: true, default: "seed-script" },
    notes: { type: String },
  },
  { collection: "service_configs" }
);
SvcConfigSchema.index(
  { slug: 1, version: 1 },
  { unique: true, name: "uniq_slug_version" }
);
const SvcConfig =
  mongoose.models.SvcConfig ||
  mongoose.model("SvcConfig", SvcConfigSchema, "service_configs");

const etagOf = (slug, version, configRevision, policy) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify({ slug, version, configRevision, policy }))
    .digest("base64url");
const rule = (method, path, userAssertion, isPublic = false, opId) => ({
  method,
  path,
  userAssertion,
  public: !!isPublic,
  ...(opId ? { opId } : {}),
});
const makePolicy = (revision, rules, defaults) => ({
  revision,
  defaults: { public: false, userAssertion: "required", ...(defaults || {}) },
  rules,
});

const HEALTH = [rule("GET", "/v1/health", "optional", true, "health")];

const GATEWAY_BASE = process.env.GATEWAY_BASE_URL || "http://127.0.0.1:4000";
const AUTH_BASE = process.env.AUTH_BASE_URL || "http://127.0.0.1:4010";
const USER_BASE = process.env.USER_BASE_URL || "http://127.0.0.1:4020";
const ACT_BASE = process.env.ACT_BASE_URL || "http://127.0.0.1:4030";
const GEO_BASE = process.env.GEO_BASE_URL || "http://127.0.0.1:4040";
const AUDIT_BASE = process.env.AUDIT_BASE_URL || "http://127.0.0.1:4050";
const SVCCONFIG_BASE =
  process.env.SVCCONFIG_BASE_URL || "http://127.0.0.1:5000";

const SEEDS = [
  {
    slug: "gateway",
    version: 1,
    baseUrl: GATEWAY_BASE,
    outboundApiPrefix: "/api",
    policy: makePolicy(1, [
      rule("GET", "/v1/health", "optional", true, "gw-health"),
      rule("GET", "/v1/jwks", "optional", true, "gw-jwks"),
    ]),
    notes: "Gateway service config",
  },
  {
    slug: "auth",
    version: 1,
    baseUrl: AUTH_BASE,
    outboundApiPrefix: "/api",
    policy: makePolicy(1, [
      ...HEALTH,
      rule("PUT", "/v1/*", "optional", true, "auth-create"),
      rule("POST", "/v1/login*", "optional", true, "auth-login"),
      rule("POST", "/v1/password*", "optional", true, "auth-password"),
      rule("DELETE", "/v1/*", "required", false, "auth-delete"),
      rule("PATCH", "/v1/*", "required", false, "auth-patch"),
    ]),
    notes: "Auth service",
  },
  {
    slug: "user",
    version: 1,
    baseUrl: USER_BASE,
    outboundApiPrefix: "/api",
    policy: makePolicy(1, [
      ...HEALTH,
      rule("GET", "/v1/*", "required", false, "user-get"),
      rule("PUT", "/v1/*", "required", false, "user-put"),
      rule("PATCH", "/v1/*", "required", false, "user-patch"),
      rule("DELETE", "/v1/*", "required", false, "user-delete"),
    ]),
    notes: "User service",
  },
  {
    slug: "act",
    version: 1,
    baseUrl: ACT_BASE,
    outboundApiPrefix: "/api",
    policy: makePolicy(1, [
      ...HEALTH,
      rule("GET", "/v1/*", "required", false, "act-get"),
      rule("PUT", "/v1/*", "required", false, "act-put"),
      rule("PATCH", "/v1/*", "required", false, "act-patch"),
      rule("DELETE", "/v1/*", "required", false, "act-delete"),
    ]),
    notes: "Act service",
  },
  {
    slug: "geo",
    version: 1,
    baseUrl: GEO_BASE,
    outboundApiPrefix: "/api",
    policy: makePolicy(1, [
      ...HEALTH,
      rule("GET", "/v1/*", "required", false, "geo-get"),
    ]),
    notes: "Geo service",
  },
  // ← ADDED: audit entry so sync can write audit/.env.dev with an explicit port
  {
    slug: "audit",
    version: 1,
    baseUrl: AUDIT_BASE,
    outboundApiPrefix: "/api",
    policy: makePolicy(1, [
      ...HEALTH,
      // audit’s own admin/read endpoints go here as you add them
    ]),
    notes: "Audit service",
  },
  {
    slug: "svcconfig",
    version: 1,
    baseUrl: SVCCONFIG_BASE,
    outboundApiPrefix: "/api",
    policy: makePolicy(1, [...HEALTH]),
    notes: "svcconfig service",
  },
];

(async () => {
  console.log(
    `🌱 service_configs seeder connecting → ${MONGO_URI} (db=${DB_NAME})`
  );
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log("✅ connected");

  let total = 0;
  for (const seed of SEEDS) {
    const { slug, version, baseUrl, outboundApiPrefix, policy } = seed;
    const configRevision = 1;
    const etag = etagOf(slug, version, configRevision, policy);
    const doc = {
      slug,
      version,
      enabled: true,
      allowProxy: true,
      baseUrl,
      outboundApiPrefix,
      configRevision,
      policy,
      etag,
      healthPath: "/health",
      exposeHealth: true,
      protectedGetPrefixes: [],
      publicPrefixes: [],
      overrides: {},
      updatedAt: new Date(),
      updatedBy: "seed-script",
      notes: seed.notes || "",
    };
    const res = await SvcConfig.replaceOne({ slug, version }, doc, {
      upsert: true,
    });
    total += (res.upsertedCount || 0) + (res.modifiedCount || 0);
    console.log(`→ ${slug}@v${version} upserted (base=${baseUrl})`);
  }

  const count = await SvcConfig.countDocuments({});
  const sample = await SvcConfig.find(
    {},
    { _id: 0, slug: 1, version: 1, configRevision: 1, etag: 1 }
  ).lean();
  console.log(`📊 service_configs count=${count}`);
  console.log(sample);

  await mongoose.disconnect();
  if (count === 0) {
    console.error("❌ No documents inserted in service_configs");
    process.exit(2);
  }
  console.log("🎯 service_configs seed done");
})().catch((err) => {
  console.error("❌ seed_service_configs error:", err);
  process.exit(1);
});
