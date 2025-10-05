// backend/services/svcfacilitator/src/boot/boot.hydrate.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *
 * Purpose:
 * - Pre-start hydrator for svcfacilitator (DB → LKG fallback).
 * - Logs through shared logger (edge/structured output, no console.*).
 */

import fs from "fs";
import path from "path";
import { EnvLoader } from "@nv/shared/env/EnvLoader";
import {
  ServiceConfigRecord,
  type ServiceConfigMirror,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import { mirrorStore } from "../services/mirrorStore";
import { getLogger } from "@nv/shared/util/logger.provider";

const log = getLogger().bind({
  slug: "svcfacilitator",
  version: 1,
  url: "/boot/hydrate",
});

type Maybe<T> = T | null;

async function tryLoadFromDb(): Promise<Maybe<ServiceConfigMirror>> {
  const uri = process.env.SVCCONFIG_MONGO_URI;
  if (!uri) return null;

  const dbName = process.env.SVCCONFIG_MONGO_DB || "nowvibin";
  const collName = process.env.SVCCONFIG_MONGO_COLLECTION || "svcconfig";

  let mongodb: any;
  try {
    mongodb = await import("mongodb");
  } catch {
    log.warn("mongodb driver not installed; skipping DB hydration");
    return null;
  }

  const client = new mongodb.MongoClient(uri, { ignoreUndefined: true });
  try {
    await client.connect();
    const coll = client.db(dbName).collection(collName);
    const docs = await coll
      .find({ enabled: { $in: [true, false] } })
      .project({ _id: 0, __v: 0 })
      .toArray();

    if (!docs || docs.length === 0) {
      log.warn("svcconfig collection is empty");
      return null;
    }

    const mirror: ServiceConfigMirror = {};
    for (const d of docs) {
      const rec = ServiceConfigRecord.parse(d).toJSON();
      mirror[svcKey(rec.slug, rec.version)] = rec;
    }
    return mirror;
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

function loadFromLkg(): ServiceConfigMirror {
  const lkgPath = EnvLoader.requireEnv("SVCCONFIG_LKG_PATH");
  const resolved = path.isAbsolute(lkgPath)
    ? lkgPath
    : path.join(process.cwd(), lkgPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`LKG missing: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LKG parse error (invalid JSON): ${resolved}`);
  }

  const mirror = (parsed as any)?.mirror;
  if (!mirror || typeof mirror !== "object" || Array.isArray(mirror)) {
    throw new Error(
      "LKG invalid: expected object with { mirror: Record<string, ServiceConfigRecordJSON> }"
    );
  }

  return ServiceConfigRecord.parseMirror(mirror);
}

export async function preStartHydrateMirror(): Promise<void> {
  let hydrated: Maybe<ServiceConfigMirror> = null;

  try {
    hydrated = await tryLoadFromDb();
  } catch (e) {
    log.warn(`DB hydration error: ${String(e)}`);
  }

  if (!hydrated) {
    hydrated = loadFromLkg();
    log.info("hydrated from LKG snapshot");
  } else {
    log.info("hydrated from MongoDB");
  }

  mirrorStore.setMirror(hydrated);
}
