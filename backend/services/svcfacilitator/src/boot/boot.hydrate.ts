// backend/services/svcfacilitator/src/boot/boot.hydrate.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *   - ADR-0035 (SvcFacilitator Debug Instrumentation & LKG Policy)
 *
 * Purpose:
 * - Pre-start hydrator for svcfacilitator with DB→LKG fallback.
 * - Creates LKG path/file if missing (no manual seeding).
 * - Atomic LKG write on successful DB hydration.
 * - Structured debug breadcrumbs (SVF1xx–7xx).
 */

import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { EnvLoader } from "@nv/shared/env/EnvLoader";
import {
  ServiceConfigRecord,
  type ServiceConfigMirror,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import { mirrorStore } from "../services/mirrorStore";
import { getLogger } from "@nv/shared/logger/Logger";

const log = getLogger().bind({
  slug: "svcfacilitator",
  version: 1,
  url: "/boot/hydrate",
});

type Maybe<T> = T | null;

function nowIso(): string {
  return new Date().toISOString();
}

function resolveLkgPath(): string {
  const p = EnvLoader.requireEnv("SVCCONFIG_LKG_PATH");
  const base = (EnvLoader as any).findRepoRoot?.() ?? process.cwd();
  return path.isAbsolute(p) ? p : path.join(base, p);
}

function ensureLkgExists(resolvedPath: string, requestId: string): void {
  log.debug(`SVF600 lkg_read_start ${JSON.stringify({ path: resolvedPath })}`);

  const dir = path.dirname(resolvedPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    log.error(`SVF620 lkg_read_fail ${JSON.stringify({ error: String(e) })}`);
    throw e;
  }

  if (!fs.existsSync(resolvedPath)) {
    const payload = JSON.stringify(
      { savedAt: nowIso(), requestId, mirror: {} },
      null,
      2
    );

    const tmp = path.join(
      dir,
      `.svcfacilitator-lkg.${Date.now()}.${process.pid}.${Math.random()
        .toString(36)
        .slice(2)}.tmp`
    );

    try {
      fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmp, resolvedPath);
      try {
        const dfd = fs.openSync(dir, "r");
        fs.fsyncSync(dfd);
        fs.closeSync(dfd);
      } catch {
        /* noop */
      }
      log.debug(
        `SVF630 lkg_write_ok ${JSON.stringify({ path: resolvedPath })}`
      );
    } catch (e) {
      log.error(
        `SVF620 lkg_read_fail ${JSON.stringify({
          error: `create_missing_failed: ${String(e)}`,
        })}`
      );
      throw e;
    }
  } else {
    try {
      const st = fs.statSync(resolvedPath);
      log.debug(
        `SVF610 lkg_read_ok ${JSON.stringify({
          path: resolvedPath,
          mtime: st.mtime.toISOString(),
        })}`
      );
    } catch {
      /* non-fatal */
    }
  }
}

function readMirrorFromLkg(resolvedPath: string): ServiceConfigMirror | null {
  try {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as { mirror?: unknown };
    const mirrorRaw = parsed?.mirror;
    if (!mirrorRaw || typeof mirrorRaw !== "object" || Array.isArray(mirrorRaw))
      return null;

    const mirror = ServiceConfigRecord.parseMirror(
      mirrorRaw as Record<string, unknown>
    );
    return mirror;
  } catch (e) {
    log.warn(
      `SVF620 lkg_read_fail ${JSON.stringify({
        error: `parse_or_read_failed: ${String(e)}`,
      })}`
    );
    return null;
  }
}

async function writeLkgAtomic(
  resolvedPath: string,
  requestId: string,
  mirror: ServiceConfigMirror
): Promise<void> {
  const dir = path.dirname(resolvedPath);
  const tmp = path.join(
    dir,
    `.svcfacilitator-lkg.${Date.now()}.${process.pid}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`
  );

  const payload = JSON.stringify(
    { savedAt: nowIso(), requestId, mirror },
    null,
    2
  );

  fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, resolvedPath);
  try {
    const dfd = fs.openSync(dir, "r");
    fs.fsyncSync(dfd);
    fs.closeSync(dfd);
  } catch {
    /* noop */
  }
  log.debug(
    `SVF630 lkg_write_ok ${JSON.stringify({
      path: resolvedPath,
      count: Object.keys(mirror).length,
    })}`
  );
}

async function tryLoadFromDb(): Promise<Maybe<ServiceConfigMirror>> {
  const uri =
    process.env.SVCCONFIG_MONGO_URI || process.env.SVCCONFIG_DB_URI || "";
  if (!uri) {
    log.debug(
      `SVF200 db_connect_start ${JSON.stringify({ uriHost: "missing" })}`
    );
    return null;
  }

  const dbName = process.env.SVCCONFIG_MONGO_DB || "nowvibin";
  const collName = process.env.SVCCONFIG_MONGO_COLLECTION || "svcconfig";

  let mongodb: any;
  try {
    mongodb = await import("mongodb");
  } catch {
    log.warn(
      `SVF220 db_connect_fail ${JSON.stringify({
        error: "mongodb_driver_missing",
        hint: "pnpm add mongodb -w",
      })}`
    );
    return null;
  }

  const started = Date.now();
  const client = new mongodb.MongoClient(uri, { ignoreUndefined: true });

  let uriHost = "unknown";
  try {
    uriHost = new URL(uri).host || "unknown";
  } catch {
    /* noop */
  }
  log.debug(`SVF200 db_connect_start ${JSON.stringify({ uriHost })}`);

  try {
    await client.connect();
    const latency = Date.now() - started;
    log.debug(`SVF210 db_connect_ok ${JSON.stringify({ latencyMs: latency })}`);

    log.debug(
      `SVF300 load_from_db_start ${JSON.stringify({
        collection: collName,
        filter: "{ enabled in [true,false] }",
      })}`
    );

    const coll = client.db(dbName).collection(collName);
    const docs = await coll
      .find({ enabled: { $in: [true, false] } })
      .project({ _id: 0, __v: 0 })
      .toArray();

    const rawCount = docs?.length ?? 0;
    if (!docs || rawCount === 0) {
      log.debug(
        `SVF320 load_from_db_empty ${JSON.stringify({ reason: "no_docs" })}`
      );
      return null;
    }

    const mirror: ServiceConfigMirror = {};
    for (const d of docs) {
      try {
        const rec = ServiceConfigRecord.parse(d).toJSON();
        mirror[svcKey(rec.slug, rec.version)] = rec;
      } catch (e) {
        log.warn(
          `SVF420 validate_configs_fail ${JSON.stringify({
            error: `record_parse_failed: ${String(e)}`,
          })}`
        );
      }
    }

    const activeCount = Object.keys(mirror).length;
    if (activeCount === 0) {
      log.debug(
        `SVF320 load_from_db_empty ${JSON.stringify({ reason: "no_active" })}`
      );
      return null;
    }

    const checked = ServiceConfigRecord.parseMirror(mirror);
    log.debug(
      `SVF310 load_from_db_ok ${JSON.stringify({
        rawCount,
        activeCount,
      })}`
    );
    return checked;
  } catch (e) {
    log.warn(
      `SVF330 load_from_db_fail ${JSON.stringify({ error: String(e) })}`
    );
    return null;
  } finally {
    try {
      await client.close();
    } catch {
      /* noop */
    }
  }
}

export async function preStartHydrateMirror(): Promise<void> {
  const bootId = randomUUID();
  const bootStart = Date.now();

  log.debug(
    `SVF100 boot_start ${JSON.stringify({ pid: process.pid, bootId })}`
  );

  // BASIC ENV SNAPSHOT (redacted/boolean flags; no secrets)
  const required = ["SVCCONFIG_LKG_PATH"];
  const missing = required.filter((k) => !process.env[k]);
  const envSnapshot = {
    required,
    missing,
    present: {
      SVCCONFIG_LKG_PATH: Boolean(process.env.SVCCONFIG_LKG_PATH),
      SVCCONFIG_MONGO_URI: Boolean(process.env.SVCCONFIG_MONGO_URI),
      SVCCONFIG_DB_URI: Boolean(process.env.SVCCONFIG_DB_URI),
      SVCCONFIG_MONGO_DB: Boolean(process.env.SVCCONFIG_MONGO_DB),
      SVCCONFIG_MONGO_COLLECTION: Boolean(
        process.env.SVCCONFIG_MONGO_COLLECTION
      ),
      LOG_LEVEL: Boolean(process.env.LOG_LEVEL),
    },
    mongoHost: (() => {
      const uri =
        process.env.SVCCONFIG_MONGO_URI || process.env.SVCCONFIG_DB_URI || "";
      try {
        return uri ? new URL(uri).host : null;
      } catch {
        return null;
      }
    })(),
  };

  log.debug(`SVF110 env_validated ${JSON.stringify(envSnapshot)}`);

  // Ensure LKG path & file exist (never manual seeding)
  const lkgPath = resolveLkgPath();
  ensureLkgExists(lkgPath, bootId);

  // 1) Try DB first
  const dbMirror = await tryLoadFromDb();
  if (dbMirror && Object.keys(dbMirror).length > 0) {
    mirrorStore.setMirror(dbMirror);
    try {
      await writeLkgAtomic(lkgPath, bootId, dbMirror);
    } catch (e) {
      log.warn(
        `SVF520 mirror_write_fail ${JSON.stringify({
          error: `lkg_write_failed: ${String(e)}`,
        })}`
      );
    }
    const duration = Date.now() - bootStart;
    log.info(
      `SVF700 ready ${JSON.stringify({
        count: Object.keys(dbMirror).length,
        source: "db",
        warmed: true,
        durationMs: duration,
        host: os.hostname(),
      })}`
    );
    return;
  }

  // 2) Fallback to LKG (which now exists)
  const lkgMirror = readMirrorFromLkg(lkgPath);
  if (lkgMirror && Object.keys(lkgMirror).length > 0) {
    mirrorStore.setMirror(lkgMirror);
    const duration = Date.now() - bootStart;
    log.info(
      `SVF700 ready ${JSON.stringify({
        count: Object.keys(lkgMirror).length,
        source: "lkg",
        warmed: true,
        durationMs: duration,
        host: os.hostname(),
      })}`
    );
    return;
  }

  // 3) Nothing usable → fail-fast per SOP
  const duration = Date.now() - bootStart;
  log.error(
    `SVF710 not_ready ${JSON.stringify({
      reason: "no_db_no_lkg",
      durationMs: duration,
    })}`
  );
  throw new Error("SvcFacilitator boot failed: no DB configs and empty LKG");
}
