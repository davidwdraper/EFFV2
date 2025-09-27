// scripts/seed/seed_route_policies.cjs
/* Fail-fast seeder for routePolicies (eff_svcconfig_db) with loud logs */
const mongoose = require("mongoose");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/eff_svcconfig_db";
const DB_NAME = "eff_svcconfig_db";

const RouteRuleSchema = new mongoose.Schema(
  {
    method: { type: String, required: true, uppercase: true, trim: true },
    path: { type: String, required: true, trim: true },
    public: { type: Boolean, required: true, default: false },
    userAssertion: {
      type: String,
      enum: ["required", "optional", "forbidden"],
      required: true,
      default: "required",
    },
    opId: { type: String, trim: true },
  },
  { _id: false }
);

const RoutePolicySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, index: true },
    version: { type: Number, required: true, index: true },
    revision: { type: Number, required: true, default: 1 },
    rules: { type: [RouteRuleSchema], required: true, default: [] },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "routePolicies", minimize: true }
);

RoutePolicySchema.index(
  { slug: 1, version: 1 },
  { unique: true, name: "uniq_policy_slug_version" }
);
const RoutePolicy =
  mongoose.models.RoutePolicy ||
  mongoose.model("RoutePolicy", RoutePolicySchema, "routePolicies");

const rule = (m, p, u, pub = false, opId) => ({
  method: m,
  path: p,
  userAssertion: u,
  public: !!pub,
  ...(opId ? { opId } : {}),
});
const HEALTH = [rule("GET", "/v1/health", "optional", true, "health")];

const SEEDS = [
  {
    slug: "gateway",
    version: 1,
    revision: 1,
    rules: [
      rule("GET", "/v1/health", "optional", true, "gw-health"),
      rule("GET", "/v1/jwks", "optional", true, "gw-jwks"),
    ],
  },
  {
    slug: "auth",
    version: 1,
    revision: 1,
    rules: [
      ...HEALTH,
      rule("PUT", "/v1/*", "optional", true, "auth-create"),
      rule("POST", "/v1/login*", "optional", true, "auth-login"),
      rule("POST", "/v1/password*", "optional", true, "auth-password"),
      rule("DELETE", "/v1/*", "required", false, "auth-delete"),
      rule("PATCH", "/v1/*", "required", false, "auth-patch"),
    ],
  },
  {
    slug: "user",
    version: 1,
    revision: 1,
    rules: [
      ...HEALTH,
      rule("GET", "/v1/*", "required", false, "user-get"),
      rule("PUT", "/v1/*", "required", false, "user-put"),
      rule("PATCH", "/v1/*", "required", false, "user-patch"),
      rule("DELETE", "/v1/*", "required", false, "user-delete"),
    ],
  },
  {
    slug: "act",
    version: 1,
    revision: 1,
    rules: [
      ...HEALTH,
      rule("GET", "/v1/*", "required", false, "act-get"),
      rule("PUT", "/v1/*", "required", false, "act-put"),
      rule("PATCH", "/v1/*", "required", false, "act-patch"),
      rule("DELETE", "/v1/*", "required", false, "act-delete"),
    ],
  },
  {
    slug: "geo",
    version: 1,
    revision: 1,
    rules: [...HEALTH, rule("GET", "/v1/*", "required", false, "geo-get")],
  },
];

(async () => {
  console.log(
    `🌱 routePolicies seeder connecting → ${MONGO_URI} (db=${DB_NAME})`
  );
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  console.log("✅ connected");

  for (const seed of SEEDS) {
    const { slug, version } = seed;
    await RoutePolicy.replaceOne(
      { slug, version },
      { ...seed, updatedAt: new Date() },
      { upsert: true }
    );
    console.log(`→ routePolicies upserted ${slug}@v${version}`);
  }

  const count = await RoutePolicy.countDocuments({});
  const sample = await RoutePolicy.find(
    {},
    { _id: 0, slug: 1, version: 1, revision: 1 }
  ).lean();
  console.log(`📊 routePolicies count=${count}`);
  console.log(sample);

  await mongoose.disconnect();
  if (count === 0) {
    console.error("❌ No documents inserted in routePolicies");
    process.exit(2);
  }
  console.log("🎯 routePolicies seed done");
})().catch((err) => {
  console.error("❌ seed_route_policies error:", err);
  process.exit(1);
});
