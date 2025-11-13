#!/usr/bin/env node

/**
 * CLI: env-service clone
 *
 * Hard-coded environment and target endpoint.
 */

const TARGET_URL = "http://127.0.0.1:4015/api/env-service/v1/env-service/clone";
const NV_MONGO_URI = "mongodb://127.0.0.1:27017";
const NV_MONGO_DB = "nv_env";

// --- seed local process env for the service if it reads process.env ---
process.env.NV_MONGO_URI = NV_MONGO_URI;
process.env.NV_MONGO_DB = NV_MONGO_DB;

/**
 * For now we still take args, but these could be hardcoded too.
 * Example:
 *   ./env-service-clone.mjs --fromSlugKey env-service@1@env --toSlug xxx
 */
function parseArgs(argv) {
  let fromSlugKey;
  let toSlug;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fromSlugKey" || arg === "--from") {
      fromSlugKey = argv[++i];
    } else if (arg === "--toSlug" || arg === "--to") {
      toSlug = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    }
  }

  if (!fromSlugKey || !toSlug) {
    console.error("❌ Error: --fromSlugKey and --toSlug are required.\n");
    printUsageAndExit(1);
  }

  return { fromSlugKey, toSlug };
}

function printUsageAndExit(code) {
  console.log(`
Usage:
  env-service-clone --fromSlugKey <slug@ver@env> --toSlug <new-slug>

Example:
  env-service-clone --fromSlugKey env-service@1@env --toSlug user-service
`);
  process.exit(code);
}

async function main() {
  const { fromSlugKey, toSlug } = parseArgs(process.argv);

  const url = `${TARGET_URL}/${encodeURIComponent(
    fromSlugKey
  )}/${encodeURIComponent(toSlug)}`;

  console.log(`
🚀 Cloning EnvService record
-----------------------------------
FROM: ${fromSlugKey}
TO:   ${toSlug}
URL:  ${url}

Using:
  NV_MONGO_URI=${NV_MONGO_URI}
  NV_MONGO_DB=${NV_MONGO_DB}
`);

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-NV-MONGO-URI": NV_MONGO_URI,
      "X-NV-MONGO-DB": NV_MONGO_DB,
    },
    // body optional; backend uses route params
    body: JSON.stringify({}),
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }

  if (!res.ok) {
    console.error(`❌ Clone failed (${res.status} ${res.statusText})`);
    console.error("Response:", body);
    process.exit(1);
  }

  console.log("✅ Clone succeeded!");
  if (body) console.log("Response:", body);
}

main().catch((err) => {
  console.error("💥 Unexpected error:", err);
  process.exit(1);
});
