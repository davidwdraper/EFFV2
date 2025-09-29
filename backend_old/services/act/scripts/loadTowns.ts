// backend/services/act/scripts/loadTowns.ts
// Purpose: Download SimpleMaps US Cities CSV (optionally zipped), parse, and upsert Towns.
// Run: yarn workspace act-service load:towns
// Env (required): ACT_MONGO_URI, SIMPLEMAPS_URL
// Env (optional): SIMPLEMAPS_AUTH_HEADER, SIMPLEMAPS_TOKEN, SIMPLEMAPS_TIMEOUT_MS, LOG_LEVEL, AUDIT_LOG_PATH
// Env (logger service): LOG_SERVICE_URL, LOG_SERVICE_TOKEN_CURRENT, ACT_SERVICE_NAME (or SERVICE_NAME)
//
// Notes:
// - No collection drop. Upsert key = { name, state }.
// - Updates lat/lng + loc atomically. Preserves existing _id for stability.
// - Writes vendor metadata (etag/lastModified/version) to vendor_meta collection.
// - Safe for rerun; skips work if 304 Not Modified is returned.
// - Emits JSON audit logs at start and end to BOTH stdout/file and the central log service (postAudit).

// --- Load env BEFORE anything that reads process.env (esp. logger) ---
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: process.env.ENV_FILE
    ? path.resolve(process.cwd(), process.env.ENV_FILE)
    : path.resolve(process.cwd(), ".env"),
});

// After env is loaded, bring in logger (it requires LOG_LEVEL, etc.)
/* eslint-disable @typescript-eslint/no-var-requires */
const { logger, postAudit } = require("../../shared/utils/logger");
/* eslint-enable @typescript-eslint/no-var-requires */

import fs from "node:fs";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import mongoose, { Schema, model } from "mongoose";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

// ---------- Required envs ----------
const REQUIRED_ENVS = ["ACT_MONGO_URI", "SIMPLEMAPS_URL"] as const;
for (const k of REQUIRED_ENVS) {
  if (!process.env[k]) {
    logger.error({ missingEnv: k }, "[TownsLoader] Missing required env");
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

const MONGO_URI = process.env.ACT_MONGO_URI!;
let SRC_URL = process.env.SIMPLEMAPS_URL!;
const AUTH_HEADER = process.env.SIMPLEMAPS_AUTH_HEADER;
const TOKEN = process.env.SIMPLEMAPS_TOKEN;
const TIMEOUT_MS = Number(process.env.SIMPLEMAPS_TIMEOUT_MS || 20000);
const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH;

// ---------- Minimal inline Town model ----------
const TownSchema = new Schema(
  {
    name: { type: String, required: true },
    state: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    vendor: {
      src: { type: String, default: "simplemaps.us-cities" },
      version: { type: String },
      updatedAt: { type: Date },
    },
  },
  { strict: true, collection: "towns" }
);
TownSchema.index({ name: 1, state: 1 }, { unique: true });
TownSchema.index({ loc: "2dsphere" });
const Town = model("TownLoaderOnly", TownSchema);

const VendorMetaSchema = new Schema(
  {
    _id: { type: String, required: true },
    etag: { type: String },
    lastModified: { type: String },
    version: { type: String },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { strict: true, collection: "vendor_meta" }
);
const VendorMeta = model("VendorMeta", VendorMetaSchema);

// ---------- audit logging (stdout/file + central log service) ----------
async function writeAudit(rec: Record<string, any>) {
  const line = JSON.stringify(rec);
  // emit to stdout for shipping/grep
  // eslint-disable-next-line no-console
  console.log(line);
  // optional local file sink
  if (AUDIT_LOG_PATH) {
    try {
      fs.appendFileSync(AUDIT_LOG_PATH, line + "\n", "utf8");
    } catch (e) {
      logger.warn(
        { err: String(e) },
        "[TownsLoader] AUDIT_LOG_PATH append failed (non-fatal)"
      );
    }
  }
  // emit to central log service (postAudit batches accepted; we send single-record arrays here)
  try {
    await postAudit([rec]);
  } catch (e) {
    // do not fail the batch load due to external logging troubles
    logger.warn(
      { err: String(e) },
      "[TownsLoader] postAudit failed (non-fatal)"
    );
  }
}

// ---------- Helpers for local paths ----------
function isProbablyUrl(u: string) {
  // treat http/https as remote; file:// and everything else as local
  return /^https?:\/\//i.test(u);
}
function isFileUrl(u: string) {
  return /^file:\/\//i.test(u);
}
function expandTilde(p: string) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  return p;
}
function resolveLocalPath(input: string) {
  if (isFileUrl(input)) {
    try {
      const u = new URL(input);
      // URL pathname is already absolute & URL-decoded below
      return decodeURIComponent(u.pathname);
    } catch {
      return input;
    }
  }
  const maybe = expandTilde(input);
  return path.isAbsolute(maybe) ? maybe : path.resolve(process.cwd(), maybe);
}

// ---------- HTTP (or local file) download with cache headers ----------
async function httpGetWithCache(
  url: string,
  headers: Record<string, string> = {}
) {
  // Allow local filesystem usage for SIMPLEMAPS_URL (zip or csv)
  if (!isProbablyUrl(url)) {
    const abs = resolveLocalPath(url);
    const stats = fs.statSync(abs);
    const h = new Headers();
    h.set("last-modified", new Date(stats.mtimeMs).toUTCString());
    h.set(
      "content-disposition",
      `attachment; filename="${path.basename(abs)}"`
    );
    return {
      status: 200 as const,
      headers: h,
      bodyPath: abs,
    };
  }

  if (isFileUrl(url)) {
    const abs = resolveLocalPath(url);
    const stats = fs.statSync(abs);
    const h = new Headers();
    h.set("last-modified", new Date(stats.mtimeMs).toUTCString());
    h.set(
      "content-disposition",
      `attachment; filename="${path.basename(abs)}"`
    );
    return {
      status: 200 as const,
      headers: h,
      bodyPath: abs,
    };
  }

  // Remote HTTP(S) fetch with conditional headers
  const metaId = "simplemaps.us-cities";
  const prior = await VendorMeta.findById(metaId)
    .lean()
    .exec()
    .catch(() => null);

  const reqHeaders: Record<string, string> = {
    "User-Agent": "NowVibin-TownsLoader/1.0",
  };
  if (AUTH_HEADER) {
    const [k, ...rest] = AUTH_HEADER.split(":");
    reqHeaders[k.trim()] = rest.join(":").trim();
  }
  if (TOKEN && !url.includes("key=")) {
    url =
      url +
      (url.includes("?")
        ? `&key=${encodeURIComponent(TOKEN)}`
        : `?key=${encodeURIComponent(TOKEN)}`);
  }
  if (prior?.etag) reqHeaders["If-None-Match"] = prior.etag;
  if (prior?.lastModified) reqHeaders["If-Modified-Since"] = prior.lastModified;
  Object.assign(reqHeaders, headers);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS).unref();
  const res = await fetch(url, {
    headers: reqHeaders,
    signal: controller.signal,
  });
  clearTimeout(t);

  if (res.status === 304) {
    return {
      status: 304 as const,
      headers: res.headers,
      bodyPath: null as string | null,
    };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const tmp = path.join(os.tmpdir(), `nv-towns-${Date.now()}`);
  const outPath = fs.createWriteStream(tmp);
  await pipeline(res.body as any, outPath);
  return { status: res.status as 200, headers: res.headers, bodyPath: tmp };
}

function deriveFileName(url: string, headers: Headers) {
  const cd = headers.get("content-disposition") || "";
  const m = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
  if (m && m[1]) return m[1];
  try {
    if (isFileUrl(url)) {
      const u = new URL(url);
      return path.basename(u.pathname);
    }
    const u = new URL(url);
    return path.basename(u.pathname);
  } catch {
    // treat it as a local path string
    return path.basename(url);
  }
}

async function openCsvStream(tempPath: string, guessedName: string) {
  const lower = guessedName.toLowerCase();
  if (lower.endsWith(".gz")) {
    const rs = createReadStream(tempPath);
    return rs.pipe(createGunzip());
  }
  if (lower.endsWith(".zip")) {
    let unzipper: any;
    try {
      // dynamic import; relies on local shim types if present
      // (types/unzipper.d.ts with: declare module "unzipper";)
      // @ts-ignore - js module without types by default
      const mod = await import("unzipper");
      unzipper = (mod as any).default ?? mod;
    } catch {
      throw new Error(
        'Zip file detected but "unzipper" is not installed. Install with: yarn add unzipper'
      );
    }
    if (!unzipper || typeof unzipper.ParseOne !== "function") {
      throw new Error(
        'Zip file detected but "unzipper.ParseOne" is unavailable. Check your unzipper version.'
      );
    }
    const rs = createReadStream(tempPath).pipe(unzipper.ParseOne(/\.csv$/i));
    return rs as unknown as NodeJS.ReadableStream;
  }
  return createReadStream(tempPath);
}

// ---------- CSV ingestion ----------
type Row = { city: string; state_id: string; lat: string; lng: string };

function normState(s: string) {
  return (s || "").trim().toUpperCase();
}
function num(v: string, field: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${field}: ${v}`);
  return n;
}

async function ingestCsvStream(csvStream: NodeJS.ReadableStream) {
  let provided = 0;
  let inserts = 0;
  let updates = 0;
  const BATCH = 1000;
  const ops: any[] = [];

  const parser = csvStream.pipe(
    parse({ columns: true, trim: true, skip_empty_lines: true })
  );

  for await (const r of parser as AsyncIterable<Row>) {
    const city = String(r.city || "").trim();
    const state = normState(r.state_id || "");
    if (!city || !state) continue;
    const lat = num(String(r.lat), "lat");
    const lng = num(String(r.lng), "lng");

    ops.push({
      updateOne: {
        filter: { name: city, state },
        update: {
          $setOnInsert: { name: city, state },
          $set: {
            lat,
            lng,
            loc: { type: "Point", coordinates: [lng, lat] },
            "vendor.src": "simplemaps.us-cities",
            "vendor.updatedAt": new Date(),
          },
        },
        upsert: true,
      },
    });
    provided++;

    if (ops.length >= BATCH) {
      const res = await Town.bulkWrite(ops, { ordered: false });
      inserts += res.upsertedCount || 0;
      updates += res.modifiedCount || 0;
      ops.length = 0;
      await delay(0);
    }
  }

  if (ops.length) {
    const res = await Town.bulkWrite(ops, { ordered: false });
    inserts += res.upsertedCount || 0;
    updates += res.modifiedCount || 0;
  }

  return { provided, inserts, updates };
}

// ---------- Main ----------
async function main() {
  await mongoose.connect(MONGO_URI, { autoIndex: true });
  await ensureIndexes();

  const t0 = Date.now();
  const runId = randomUUID(); // correlation id across start/end
  const startStamp = new Date().toISOString();

  const { status, headers, bodyPath } = await httpGetWithCache(SRC_URL);
  if (status === 304) {
    const prior = await VendorMeta.findById("simplemaps.us-cities")
      .lean()
      .exec();
    await writeAudit({
      event: "towns_loader",
      phase: "start",
      runId,
      src: "simplemaps.us-cities",
      startedAt: startStamp,
      fileName: "not-modified",
      version: prior?.version || null,
    });
    await writeAudit({
      event: "towns_loader",
      phase: "end",
      runId,
      src: "simplemaps.us-cities",
      startedAt: startStamp,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      fileName: "not-modified",
      version: prior?.version || null,
      totals: { provided: 0, inserts: 0, updates: 0 },
    });
    logger.info(
      { runId },
      "[TownsLoader] Remote file unchanged (304). Skipping load."
    );
    await mongoose.disconnect();
    return;
  }

  const fileName = deriveFileName(SRC_URL, headers);
  const version = inferVersionFromNameOrHeaders(fileName, headers);

  await writeAudit({
    event: "towns_loader",
    phase: "start",
    runId,
    src: "simplemaps.us-cities",
    startedAt: startStamp,
    fileName,
    version,
  });

  const csvStream = await openCsvStream(bodyPath!, fileName);
  const stats = await ingestCsvStream(csvStream);

  const metaId = "simplemaps.us-cities";
  const etag = headers.get("etag") || undefined;
  const lastModified = headers.get("last-modified") || undefined;
  await VendorMeta.updateOne(
    { _id: metaId },
    { $set: { etag, lastModified, version, updatedAt: new Date() } },
    { upsert: true }
  );

  if (version) {
    await Town.updateMany(
      { "vendor.src": "simplemaps.us-cities" },
      { $set: { "vendor.version": version } }
    ).catch(() => {});
  }

  const durationMs = Date.now() - t0;

  await writeAudit({
    event: "towns_loader",
    phase: "end",
    runId,
    src: "simplemaps.us-cities",
    startedAt: startStamp,
    endedAt: new Date().toISOString(),
    durationMs,
    fileName,
    version,
    totals: {
      provided: stats.provided,
      inserts: stats.inserts,
      updates: stats.updates,
    },
  });

  logger.info(
    {
      runId,
      provided: stats.provided,
      inserts: stats.inserts,
      updates: stats.updates,
      version: version || "n/a",
    },
    "[TownsLoader] Completed"
  );

  try {
    if (bodyPath && isProbablyUrl(SRC_URL)) fs.unlinkSync(bodyPath); // only cleanup temp for HTTP downloads
  } catch {}
  await mongoose.disconnect();
}

function inferVersionFromNameOrHeaders(name: string, headers: Headers) {
  const m = /(\d{4}-\d{2}-\d{2}|\d{8})/.exec(name);
  if (m) return m[1];
  const lm = headers.get("last-modified");
  return lm || undefined;
}

async function ensureIndexes() {
  await Town.collection
    .createIndex({ name: 1, state: 1 }, { unique: true })
    .catch(() => {});
  await Town.collection.createIndex({ loc: "2dsphere" }).catch(() => {});
}

main().catch((e) => {
  logger.error({ err: String(e?.stack || e) }, "[TownsLoader] Fatal");
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});
