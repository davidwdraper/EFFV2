// backend/services/log/test/setup.ts
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

// ── Test env defaults (must exist BEFORE app import) ──────────────────────────
process.env.NODE_ENV ??= "test";
process.env.LOG_LEVEL ??= "debug";

// App/service-required
process.env.LOG_SERVICE_NAME ??= "log"; // required by config.ts
process.env.SERVICE_NAME ??= "log-service-test"; // optional, useful in logs
process.env.LOG_PORT ??= "4006"; // <- required number env

// Auth tokens (rotation-aware)
process.env.LOG_SERVICE_TOKEN_CURRENT ??= "test-current-key";
process.env.LOG_SERVICE_TOKEN_NEXT ??= "test-next-key";

// DB + FS cache
process.env.LOG_MONGO_URI ??= "mongodb://127.0.0.1:27017/eff_log_test";
process.env.LOG_FS_DIR ??= "tmp-logs/nv-log-cache-test";

// Logger util endpoints (E2E will override to the ephemeral port)
process.env.LOG_SERVICE_URL ??= "http://127.0.0.1:0/logs";
process.env.LOG_SERVICE_HEALTH_URL ??= "http://127.0.0.1:0/health/deep";

// ── FS cache reset helper ─────────────────────────────────────────────────────
export async function resetFsDir() {
  const FS_DIR = path.resolve(process.env.LOG_FS_DIR!);

  // If something exists at FS_DIR but it's a file, remove it
  try {
    const st = await fsp.stat(FS_DIR);
    if (!st.isDirectory()) {
      await fsp.rm(FS_DIR, { force: true });
    }
  } catch {
    // does not exist → fine
  }

  await fsp.mkdir(FS_DIR, { recursive: true });

  const entries = await fsp.readdir(FS_DIR).catch(() => []);
  await Promise.all(
    entries.map((n) =>
      fsp.rm(path.join(FS_DIR, n), { force: true, recursive: true })
    )
  );
}
