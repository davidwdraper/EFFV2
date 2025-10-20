// backend/services/svcfacilitator/src/services/mirror.audit.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0033 (Internal-Only Services & S2S Verification Defaults)
 *
 * Purpose:
 * - Operator-friendly audit comparing DB-included svcconfigs with the in-memory mirror.
 * - Inclusion policy (canonical): enabled === true && internalOnly === false.
 *
 * Behavior:
 * - On mismatch, emit a WARN with structured breakdown.
 * - Always logs a one-line INFO summary.
 * - Diagnostics-only: never throws. (But uses no env defaults/fallbacks.)
 *
 * Env (no defaults, no fallbacks):
 * - SVCCONFIG_MONGO_URI
 * - SVCCONFIG_MONGO_DB
 * - SVCCONFIG_MONGO_COLLECTION
 */

import { MongoClient, ObjectId, type Document } from "mongodb";
import { getLogger } from "@nv/shared/logger/Logger";
import { mirrorStore } from "./mirrorStore";
import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";

type RawDoc = Record<string, unknown>;
type Bucket = "included" | "disabled" | "internal_only" | "invalid";

const log = getLogger().bind({ component: "mirror.audit" });

function requireEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== "string" || v.trim() === "") return null;
  return v.trim();
}

function keyOf(doc: RawDoc): string | null {
  const slug = String((doc as any)?.slug || "")
    .trim()
    .toLowerCase();
  const v = Number((doc as any)?.version);
  if (!slug || !Number.isFinite(v) || v < 1) return null;
  return svcKey(slug, v);
}

function normalizeId(d: RawDoc): RawDoc {
  const rawId = (d as any)?._id;
  if (rawId instanceof ObjectId) return { ...d, _id: rawId.toHexString() };
  if (rawId && typeof rawId === "object" && "$oid" in (rawId as any)) {
    return { ...d, _id: String((rawId as any).$oid) };
  }
  return d;
}

export async function auditMirrorVsDb(): Promise<void> {
  const uri = requireEnv("SVCCONFIG_MONGO_URI");
  const dbName = requireEnv("SVCCONFIG_MONGO_DB");
  const collName = requireEnv("SVCCONFIG_MONGO_COLLECTION");

  // No defaults. If missing envs, skip audit (diagnostics-only) and be explicit.
  if (!uri || !dbName || !collName) {
    log.warn(
      {
        haveUri: Boolean(uri),
        haveDbName: Boolean(dbName),
        haveColl: Boolean(collName),
      },
      "svcconfig_audit_skipped_missing_env"
    );
    return;
  }

  // Breadcrumb: where are we auditing
  log.debug("AUD100 audit_start", {
    uriHost: (() => {
      try {
        return new URL(uri).host;
      } catch {
        return "bad-uri";
      }
    })(),
    db: dbName,
    coll: collName,
  });

  const client = new MongoClient(uri, { ignoreUndefined: true });

  try {
    await client.connect();

    const coll = client.db(dbName).collection<Document>(collName);
    const docs = await coll.find({}).project({ __v: 0 }).toArray();

    // Buckets by inclusion policy (no allowProxy anywhere).
    const breakdown: Record<Bucket, string[]> = {
      included: [],
      disabled: [],
      internal_only: [],
      invalid: [],
    };

    for (const d0 of docs) {
      const d = normalizeId(d0 as RawDoc);
      const k = keyOf(d) || "<bad-key>";
      try {
        const rec = ServiceConfigRecord.parse(d);
        if (!rec.enabled) {
          breakdown.disabled.push(k);
        } else if (rec.internalOnly) {
          breakdown.internal_only.push(k);
        } else {
          breakdown.included.push(k);
        }
      } catch (e) {
        breakdown.invalid.push(k === "<bad-key>" ? String(e) : `${k}`);
      }
    }

    const includedSet = new Set(breakdown.included);
    const mirror = mirrorStore.getMirror();
    const mirrorKeys = Object.keys(mirror);

    const dbCount = includedSet.size; // apples-to-apples
    const mirrorCount = mirrorKeys.length; // included in memory

    // INFO summary (always)
    log.info(
      {
        dbCount,
        mirrorCount,
        included: breakdown.included.length,
        disabled: breakdown.disabled.length,
        internal_only: breakdown.internal_only.length,
        invalid: breakdown.invalid.length,
      },
      "svcconfig_audit_summary"
    );

    if (dbCount !== mirrorCount) {
      const includedButMissing = breakdown.included.filter((k) => !mirror[k]);
      const mirrorButNotIncluded = mirrorKeys.filter(
        (k) => !includedSet.has(k)
      );

      log.warn(
        {
          dbCount,
          mirrorCount,
          reasons: {
            disabled: breakdown.disabled.slice(0, 10),
            internal_only: breakdown.internal_only.slice(0, 10),
            invalid: breakdown.invalid.slice(0, 10),
          },
          includedButMissing: includedButMissing.slice(0, 10),
          mirrorButNotIncluded: mirrorButNotIncluded.slice(0, 10),
          note: "Counts differ. See reasons.* buckets (up to 10 shown). Fix invalid docs or flags.",
        },
        "svcconfig_audit_mismatch"
      );
    }
  } catch (e) {
    log.warn({ err: String(e) }, "svcconfig_audit_failed");
  } finally {
    try {
      await client.close();
    } catch {
      /* noop */
    }
  }
}
