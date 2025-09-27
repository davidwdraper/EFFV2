// scripts/sync/sync_ports_from_svcconfig.cjs
/**
 * SOP: svcconfig-driven ports (ADR-0034). No hardcoded ports, no silent defaults.
 * This script writes per-service .env.dev with PORT and <SLUG>_PORT to match svcconfig.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const REPO_ROOT = fs.realpathSync(path.join(__dirname, "..", ".."));
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/eff_svcconfig_db";
const DB_NAME =
  new URL(MONGO_URI).pathname.replace(/^\//, "") || "eff_svcconfig_db";
const DRY_RUN = process.env.DRY_RUN === "1";

// ← ADDED: include audit so it actually gets a PORT written
const SERVICE_PATHS = {
  gateway: "backend/services/gateway",
  svcconfig: "backend/services/svcconfig",
  auth: "backend/services/auth",
  user: "backend/services/user",
  act: "backend/services/act",
  geo: "backend/services/geo",
  log: "backend/services/log",
  audit: "backend/services/audit",
};

function ensureDir(p) {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}
function parsePortFromUrl(u) {
  let port = u.port;
  if (!port || !/^\d+$/.test(port))
    port = u.protocol === "https:" ? "443" : "80";
  return Number(port);
}
function readEnvFile(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/);
}
function writeEnvFile(file, lines) {
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

function upsertKV(lines, key, val) {
  const newline = `${key}=${val}`;
  const idx = lines.findIndex((l) => new RegExp(`^${key}=`).test(l));
  if (idx >= 0) {
    if (lines[idx] === newline) return { changed: false, lines };
    const out = lines.slice();
    out[idx] = newline;
    return { changed: true, lines: out };
  } else {
    const out = lines.slice();
    out.push(newline);
    return { changed: true, lines: out };
  }
}

async function main() {
  console.log(
    `🔌 Syncing service ports from svcconfig (${MONGO_URI}, db=${DB_NAME})`
  );
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  const SvcConfigSchema = new mongoose.Schema(
    {
      slug: String,
      version: Number,
      baseUrl: String,
      outboundApiPrefix: String,
    },
    { collection: "service_configs" }
  );
  const SvcConfig =
    mongoose.models.__SyncSvcConfig ||
    mongoose.model("__SyncSvcConfig", SvcConfigSchema, "service_configs");

  const rows = await SvcConfig.find(
    {},
    { _id: 0, slug: 1, version: 1, baseUrl: 1 }
  )
    .lean()
    .exec();
  if (!rows.length) {
    console.error(
      "❌ No service_configs found. Did you seed eff_svcconfig_db?"
    );
    process.exit(2);
  }

  let updates = 0;
  for (const r of rows) {
    const slug = String(r.slug || "").trim();
    const rel = SERVICE_PATHS[slug];
    if (!slug || !rel) continue; // ignore services we don't track locally

    const svcDir = path.join(REPO_ROOT, rel);
    if (!ensureDir(svcDir)) continue;

    let baseUrl;
    try {
      baseUrl = new URL(r.baseUrl);
    } catch {
      console.warn(
        `⚠️  Skipping ${slug}@v${r.version}: invalid baseUrl: ${r.baseUrl}`
      );
      continue;
    }

    const port = parsePortFromUrl(baseUrl);
    const envPath = path.join(svcDir, ".env.dev");
    let lines = readEnvFile(envPath);

    // Write PORT and SLUG_PORT for belt-and-suspenders with the runner + STRICT boot
    let changed = false;
    let res = upsertKV(lines, "PORT", port);
    lines = res.lines;
    changed = changed || res.changed;
    const slugUpper = slug.toUpperCase();
    res = upsertKV(lines, `${slugUpper}_PORT`, port);
    lines = res.lines;
    changed = changed || res.changed;

    if (!changed) {
      console.log(`= ${slug}: PORT already ${port} (${envPath})`);
      continue;
    }
    if (DRY_RUN) {
      console.log(
        `~ ${slug}: would set PORT=${port} and ${slugUpper}_PORT=${port} in ${envPath}`
      );
      continue;
    }

    if (fs.existsSync(envPath)) fs.copyFileSync(envPath, envPath + ".bak");
    writeEnvFile(envPath, lines);
    console.log(
      `✔ ${slug}: set PORT=${port} and ${slugUpper}_PORT=${port} in ${envPath}`
    );
    updates++;
  }

  await mongoose.disconnect();
  if (DRY_RUN) {
    console.log("👀 DRY_RUN complete (no files changed).");
  } else {
    console.log(
      updates === 0
        ? "ℹ️  No env files needed changes."
        : `✅ Sync complete. Updated ${updates} env file(s).`
    );
  }
}

main().catch((err) => {
  console.error("❌ sync failed:", err);
  process.exit(1);
});
