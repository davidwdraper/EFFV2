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
 *
 * Purpose:
 * - Load the ENTIRE svcconfig collection (no pre-filtering).
 * - Strict-parse each document via the shared contract.
 * - Build an in-memory ServiceConfigMirror keyed by "<slug>@<version>".
 * - Return counts and per-record validation errors for observability.
 *
 * Invariants:
 * - No console.* — structured logs only.
 * - No special-casing svcfacilitator — it’s treated like any other service.
 */

import { MongoClient, type Document } from "mongodb";
import { getLogger } from "@nv/shared/logger/Logger";
import {
  ServiceConfigRecord,
  type ServiceConfigMirror,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";

export type MirrorLoadResult = {
  mirror: ServiceConfigMirror;
  rawCount: number; // number of docs returned by Mongo
  activeCount: number; // number of valid records included in the mirror
  errors: Array<{ key: string; error: string }>;
};

export class MirrorDbLoader {
  private readonly log = getLogger().bind({
    slug: "svcfacilitator",
    version: 1,
    url: "/services/MirrorDbLoader",
  });

  constructor(
    private readonly uri = process.env.SVCCONFIG_MONGO_URI ||
      process.env.SVCCONFIG_DB_URI ||
      "",
    private readonly dbName = process.env.SVCCONFIG_MONGO_DB || "nowvibin",
    private readonly collName = process.env.SVCCONFIG_MONGO_COLLECTION ||
      "svcconfig"
  ) {}

  /** Returns null if URI is missing or the load fails entirely. */
  async loadFullMirror(): Promise<MirrorLoadResult | null> {
    if (!this.uri) {
      this.log.debug(
        `SVF200 db_connect_start ${JSON.stringify({ uriHost: "missing" })}`
      );
      return null;
    }

    let uriHost = "unknown";
    try {
      uriHost = new URL(this.uri).host || "unknown";
    } catch {
      /* noop */
    }
    this.log.debug(
      `SVF200 db_connect_start ${JSON.stringify({
        uriHost,
        db: this.dbName,
        coll: this.collName,
      })}`
    );

    const started = Date.now();
    const client = new MongoClient(this.uri, { ignoreUndefined: true });

    try {
      await client.connect();
      const latency = Date.now() - started;
      this.log.debug(
        `SVF210 db_connect_ok ${JSON.stringify({ latencyMs: latency })}`
      );

      // ENTIRE collection, no pre-filtering (per ADR-0020)
      this.log.debug(
        `SVF300 load_from_db_start ${JSON.stringify({
          collection: this.collName,
          filter: "none (find({}))",
        })}`
      );

      const coll = client.db(this.dbName).collection<Document>(this.collName);
      const docs = await coll.find({}).project({ _id: 0, __v: 0 }).toArray();

      const rawCount = docs?.length ?? 0;
      if (!docs || rawCount === 0) {
        this.log.debug(
          `SVF320 load_from_db_empty ${JSON.stringify({ reason: "no_docs" })}`
        );
        return null;
      }

      const mirror: ServiceConfigMirror = {};
      const errors: Array<{ key: string; error: string }> = [];

      for (const d of docs) {
        // Attempt to form a key early for better error logs; may be "<bad-key>".
        const slug = String((d as any)?.slug || "")
          .trim()
          .toLowerCase();
        const v = Number((d as any)?.version);
        const key =
          slug && Number.isFinite(v) && v >= 1 ? svcKey(slug, v) : "<bad-key>";

        try {
          const rec = ServiceConfigRecord.parse(d).toJSON();
          mirror[svcKey(rec.slug, rec.version)] = rec;
        } catch (e) {
          const err = String(e);
          errors.push({ key, error: err });
          this.log.warn(
            `SVF420 validate_configs_fail ${JSON.stringify({
              key,
              error: `record_parse_failed: ${err}`,
            })}`
          );
        }
      }

      const activeCount = Object.keys(mirror).length;
      if (activeCount === 0) {
        this.log.debug(
          `SVF320 load_from_db_empty ${JSON.stringify({
            reason: "no_valid_records",
          })}`
        );
        return null;
      }

      // Final sanity check on the assembled mirror
      const checked = ServiceConfigRecord.parseMirror(mirror);

      this.log.debug(
        `SVF310 load_from_db_ok ${JSON.stringify({
          rawCount,
          activeCount,
          invalidCount: errors.length,
        })}`
      );

      return { mirror: checked, rawCount, activeCount, errors };
    } catch (e) {
      this.log.warn(
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
}
