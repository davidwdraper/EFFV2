// backend/services/svcfacilitator/src/services/mirror.audit.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *
 * Purpose:
 * - Loud, operator-friendly audit that compares:
 *     A) Count of records in MongoDB `svcconfig`
 *     B) Count of entries included in the in-memory mirror
 * - We DO NOT pre-filter via query. We fetch ALL docs, then decide inclusion
 *   at runtime so we can log precise reasons (disabled, proxying disabled,
 *   invalid schema).
 *
 * Behavior:
 * - On mismatch (A != B), emit a WARN with a structured breakdown.
 * - Always logs a one-line INFO summary even when counts match.
 * - Never throws; this is diagnostics-only.
 *
 * Env:
 * - SVCCONFIG_DB_URI     (e.g., mongodb://127.0.0.1:27017/nowvibin_dev)
 * - SVCCONFIG_DB_NAME    (optional; if omitted, taken from URI path)
 * - SVCCONFIG_COLL       (optional; default: "svcconfig")
 */

import { MongoClient } from "mongodb";
import { getLogger } from "@nv/shared/logger/Logger";
import { mirrorStore } from "./mirrorStore";
import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";

type RawDoc = Record<string, unknown>;
type Bucket = "included" | "disabled" | "proxy_disabled" | "invalid";

const COLL_DEFAULT = "svcconfig";

function getDbPieces() {
  const uri = (process.env.SVCCONFIG_DB_URI || "").trim();
  const explicitDb = (process.env.SVCCONFIG_DB_NAME || "").trim();
  const coll =
    (process.env.SVCCONFIG_COLL || COLL_DEFAULT).trim() || COLL_DEFAULT;

  if (!uri) return { uri: "", dbName: "", coll };
  // Try to infer dbName from URI path if not provided
  let dbName = explicitDb;
  if (!dbName) {
    try {
      const u = new URL(uri);
      const path = (u.pathname || "").replace(/^\//, "");
      if (path) dbName = path;
    } catch {
      // leave empty; caller will handle
    }
  }
  return { uri, dbName, coll };
}

function keyOf(doc: RawDoc): string | null {
  const slug = String((doc as any)?.slug || "")
    .trim()
    .toLowerCase();
  const v = Number((doc as any)?.version);
  if (!slug || !Number.isFinite(v) || v < 1) return null;
  return svcKey(slug, v);
}

function categorize(doc: RawDoc): Bucket {
  // Validate flags first for messaging
  const enabled = Boolean((doc as any)?.enabled);
  const allowProxy = Boolean((doc as any)?.allowProxy);

  if (!enabled) return "disabled";
  if (!allowProxy) return "proxy_disabled";

  // Only then test schema validity (so we can distinguish invalid vs disabled)
  try {
    // We accept docs “as-is”; parse will throw if shape is bad
    ServiceConfigRecord.parse(doc);
    return "included";
  } catch {
    return "invalid";
  }
}

export async function auditMirrorVsDb(): Promise<void> {
  const log = getLogger().bind({ component: "mirror.audit" });
  const { uri, dbName, coll } = getDbPieces();

  // If we can’t connect, don’t crash — just log and exit.
  if (!uri || !dbName) {
    log.warn(
      { haveUri: Boolean(uri), haveDbName: Boolean(dbName) },
      "svcconfig_audit_skipped_missing_db_env"
    );
    return;
  }

  const client = new MongoClient(uri, { ignoreUndefined: true });
  try {
    await client.connect();
    const db = client.db(dbName);
    const col = db.collection<RawDoc>(coll);

    const docs = await col.find({}).toArray();
    const dbCount = docs.length;

    const breakdown: Record<Bucket, string[]> = {
      included: [],
      disabled: [],
      proxy_disabled: [],
      invalid: [],
    };

    for (const d of docs) {
      const k = keyOf(d) || "<bad-key>";
      const bucket = categorize(d);
      breakdown[bucket].push(k);
    }

    const includedSet = new Set(breakdown.included);
    const mirror = mirrorStore.getMirror();
    const mirrorKeys = Object.keys(mirror);
    const mirrorCount = mirrorKeys.length;

    // INFO summary (always)
    log.info(
      {
        dbCount,
        mirrorCount,
        included: breakdown.included.length,
        disabled: breakdown.disabled.length,
        proxy_disabled: breakdown.proxy_disabled.length,
        invalid: breakdown.invalid.length,
      },
      "svcconfig_audit_summary"
    );

    // If counts differ, WARN loudly with specifics.
    if (dbCount !== mirrorCount) {
      // Which included keys are missing from mirror (should be none)
      const includedButMissing = breakdown.included.filter((k) => !mirror[k]);

      // Which mirror keys didn’t come from “included” (also should be none)
      const mirrorButNotIncluded = mirrorKeys.filter(
        (k) => !includedSet.has(k)
      );

      log.warn(
        {
          dbCount,
          mirrorCount,
          reasons: {
            disabled: breakdown.disabled.slice(0, 10),
            proxy_disabled: breakdown.proxy_disabled.slice(0, 10),
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
    await client.close().catch(() => undefined);
  }
}
