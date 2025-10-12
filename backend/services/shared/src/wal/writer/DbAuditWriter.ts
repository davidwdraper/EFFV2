// backend/services/shared/src/wal/writer/DbAuditWriter.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0022 — Shared WAL & DB Base
 *   - ADR-0024 — Audit WAL Persistence Guarantee
 *   - ADR-0025 — Opaque Payloads & Writer Injection
 *   - adr0026-dbauditwriter-and-fifo-schema
 *
 * Purpose:
 * - Persist validated AuditBlob batches into a MongoDB FIFO collection.
 * - **Contract-driven**: relies strictly on AuditBlob.meta.* and .blob (no guessing).
 *
 * Contract (strict; see AuditBlobSchema):
 * {
 *   meta: { service: string, ts: number, requestId: string },
 *   blob: unknown,
 *   phase?: string,
 *   target?: ...
 * }
 *
 * Env (all required, no defaults/fallbacks):
 * - AUDIT_DB_URI
 * - AUDIT_DB_NAME
 * - AUDIT_DB_COLLECTION
 */

import type { IAuditWriter } from "./IAuditWriter";
import type { AuditBlob } from "../../contracts/audit/audit.blob.contract";
import { MongoClient, type Collection } from "mongodb";

// Singletons for process lifetime
let cachedClient: MongoClient | null = null;
let cachedCollection: Collection | null = null;

/** Read a required env var (fail-fast). */
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    const e = new Error(`DbAuditWriter: missing required env ${name}`);
    (e as any).code = "ENV_MISSING";
    throw e;
  }
  return v.trim();
}

/** Ensure a single shared Mongo collection handle. */
async function ensureCollection(): Promise<Collection> {
  if (cachedCollection) return cachedCollection;

  const uri = mustEnv("AUDIT_DB_URI");
  const dbName = mustEnv("AUDIT_DB_NAME");
  const collName = mustEnv("AUDIT_DB_COLLECTION");

  if (!cachedClient) {
    try {
      cachedClient = new MongoClient(uri, {});
      await cachedClient.connect();
    } catch (err) {
      const e = new Error(
        `DbAuditWriter: Mongo connect failed: ${
          (err as Error)?.message || String(err)
        }`
      );
      (e as any).code = "DB_CONNECT_FAILED";
      throw e;
    }
  }

  try {
    const db = cachedClient.db(dbName);
    cachedCollection = db.collection(collName);
    return cachedCollection;
  } catch (err) {
    const e = new Error(
      `DbAuditWriter: get collection failed: ${
        (err as Error)?.message || String(err)
      }`
    );
    (e as any).code = "DB_COLLECTION_FAILED";
    throw e;
  }
}

/** Document shape we persist (opaque payload under `blob`). */
type AuditDoc = {
  service: string;
  ts: number; // epoch ms
  requestId: string;
  blob: unknown; // fully opaque
};

/** Map a validated AuditBlob to the DB document shape (strict). */
function toDoc(b: AuditBlob): AuditDoc {
  // Trust strict Zod contract
  const service = b.meta?.service;
  const ts = b.meta?.ts;
  const requestId = b.meta?.requestId;

  if (typeof service !== "string" || !service) {
    const e = new Error("DbAuditWriter: meta.service missing/invalid");
    (e as any).code = "BLOB_INVALID_SERVICE";
    throw e;
  }
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    const e = new Error("DbAuditWriter: meta.ts missing/invalid");
    (e as any).code = "BLOB_INVALID_TS";
    throw e;
  }
  if (typeof requestId !== "string" || !requestId) {
    const e = new Error("DbAuditWriter: meta.requestId missing/invalid");
    (e as any).code = "BLOB_INVALID_REQUEST_ID";
    throw e;
  }

  return { service, ts, requestId, blob: b.blob };
}

export class DbAuditWriter implements IAuditWriter {
  public constructor() {
    // Fail fast on envs (connect lazily)
    mustEnv("AUDIT_DB_URI");
    mustEnv("AUDIT_DB_NAME");
    mustEnv("AUDIT_DB_COLLECTION");
  }

  public async writeBatch(batch: ReadonlyArray<AuditBlob>): Promise<void> {
    if (!Array.isArray(batch)) {
      throw Object.assign(
        new Error("DbAuditWriter.writeBatch: batch must be an array"),
        {
          code: "WRITER_BAD_INPUT",
        }
      );
    }
    if (batch.length === 0) return;

    // Contract-driven mapping; any error here is non-retryable and will be handled by WAL.
    const docs = batch.map(toDoc);

    const coll = await ensureCollection();
    try {
      await coll.insertMany(docs as any[], { ordered: false });
    } catch (err) {
      const e = new Error(
        `DbAuditWriter: insertMany failed: ${
          (err as Error)?.message || String(err)
        }`
      );
      (e as any).code = "DB_INSERT_FAILED"; // retryable by default
      (e as any).count = docs.length;
      throw e;
    }
  }
}

/** Registry-friendly factories */
export function createWriter(): IAuditWriter {
  return new DbAuditWriter();
}
export default function defaultFactory(): IAuditWriter {
  return new DbAuditWriter();
}
