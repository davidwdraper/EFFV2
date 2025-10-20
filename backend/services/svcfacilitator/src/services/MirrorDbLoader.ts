// backend/services/svcfacilitator/src/services/MirrorDbLoader.ts
/**
 * Path: backend/services/svcfacilitator/src/services/MirrorDbLoader.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *   - ADR-0033 (Internal-Only Services & S2S Verification Defaults)
 *
 * Purpose:
 * - Load the ENTIRE svcconfig collection (no pre-filtering from Mongo).
 * - Strict-parse each document via the shared contract.
 * - Build an in-memory ServiceConfigMirror keyed by "<slug>@<version>".
 * - **Include only** records with enabled===true AND internalOnly===false.
 * - Return counts and per-record validation errors for observability.
 *
 * Environment Invariance:
 * - No literals, no defaults. Fail-fast if any required ENV is missing.
 *   Required:
 *     - SVCCONFIG_MONGO_URI
 *     - SVCCONFIG_MONGO_DB
 *     - SVCCONFIG_MONGO_COLLECTION
 */

import { MongoClient, type Document, ObjectId } from "mongodb";
import { getLogger } from "@nv/shared/logger/Logger";
import {
  ServiceConfigRecord,
  type ServiceConfigMirror,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";

export type MirrorLoadResult = {
  mirror: ServiceConfigMirror;
  rawCount: number; // number of docs returned by Mongo
  activeCount: number; // number of valid, INCLUDED records (enabled && !internalOnly)
  errors: Array<{ key: string; error: string }>;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`ENV ${name} is required but not set`);
  }
  return v.trim();
}

export class MirrorDbLoader {
  private readonly log = getLogger().bind({
    slug: "svcfacilitator",
    version: 1,
    url: "/services/MirrorDbLoader",
  });

  private readonly uri: string;
  private readonly dbName: string;
  private readonly collName: string;

  constructor() {
    // Fail-fast: no defaults, no fallbacks
    this.uri = requireEnv("SVCCONFIG_MONGO_URI");
    this.dbName = requireEnv("SVCCONFIG_MONGO_DB");
    this.collName = requireEnv("SVCCONFIG_MONGO_COLLECTION");
  }

  /** Returns null only if no valid records exist after parsing; throws on env/connect errors. */
  async loadFullMirror(): Promise<MirrorLoadResult | null> {
    let uriHost = "unknown";
    try {
      uriHost = new URL(this.uri).host || "unknown";
    } catch {
      // If URL parsing fails here, MongoClient will throw below; we still log intent.
    }

    this.log.debug("SVF200 db_connect_start", {
      uriHost,
      db: this.dbName,
      coll: this.collName,
    });

    const started = Date.now();
    const client = new MongoClient(this.uri, { ignoreUndefined: true });

    try {
      await client.connect();
      const latency = Date.now() - started;
      this.log.debug("SVF210 db_connect_ok", { latencyMs: latency });

      // ENTIRE collection, no pre-filtering (per ADR-0020)
      this.log.debug("SVF300 load_from_db_start", {
        collection: this.collName,
        filter: "none (find({}))",
      });

      const coll = client.db(this.dbName).collection<Document>(this.collName);
      const docs = await coll.find({}).project({ __v: 0 }).toArray();

      const rawCount = docs?.length ?? 0;
      if (!docs || rawCount === 0) {
        this.log.debug("SVF320 load_from_db_empty", { reason: "no_docs" });
        return null;
      }

      const mirror: ServiceConfigMirror = {};
      const errors: Array<{ key: string; error: string }> = [];

      for (const d of docs) {
        const slug = String((d as any)?.slug || "")
          .trim()
          .toLowerCase();
        const v = Number((d as any)?.version);
        const key =
          slug && Number.isFinite(v) && v >= 1 ? svcKey(slug, v) : "<bad-key>";

        try {
          // Normalize _id → string form if ObjectId or {$oid}
          const rawId = (d as any)?._id;
          let id: string | undefined;
          if (rawId instanceof ObjectId) {
            id = rawId.toHexString();
          } else if (rawId && typeof rawId === "object" && "$oid" in rawId) {
            id = String((rawId as any).$oid);
          } else if (typeof rawId === "string") {
            id = rawId;
          }

          const parsed = ServiceConfigRecord.parse({
            ...d,
            ...(id ? { _id: id } : {}),
          }).toJSON();

          // Inclusion policy: enabled && !internalOnly
          if (parsed.enabled === true && parsed.internalOnly !== true) {
            mirror[svcKey(parsed.slug, parsed.version)] = parsed;
          }
        } catch (e) {
          const err = String(e);
          errors.push({ key, error: err });
          this.log.warn("SVF420 validate_configs_fail", {
            key,
            error: `record_parse_failed: ${err}`,
          });
        }
      }

      const activeCount = Object.keys(mirror).length;
      if (activeCount === 0) {
        this.log.debug("SVF320 load_from_db_empty", {
          reason: "no_valid_included_records",
        });
        return null;
      }

      // Final sanity check on the assembled mirror
      const checked = ServiceConfigRecord.parseMirror(mirror);

      this.log.debug("SVF310 load_from_db_ok", {
        rawCount,
        activeCount,
        invalidCount: errors.length,
      });

      return { mirror: checked, rawCount, activeCount, errors };
    } finally {
      try {
        await client.close();
      } catch {
        /* noop */
      }
    }
  }
}
