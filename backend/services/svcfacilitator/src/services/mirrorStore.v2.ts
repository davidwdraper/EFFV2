// backend/services/svcfacilitator/src/services/mirrorStore.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/services/mirrorStore.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys, OO form)
 *   - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *   - ADR-0033 — Internal-Only Services & S2S Verification Defaults
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *
 * Purpose:
 * - Hold the in-memory **combined** mirror (svcconfig parent + grouped route_policies).
 * - Provide TTL-based read-through caching.
 * - Persist/restore a **Last Known Good (LKG)** snapshot with **filesystem-first** fallback,
 *   and optional DB LKG as secondary.
 *
 * Invariants:
 * - No environment reads. All dependencies are injected (DbClient optional, TTL, fs path).
 * - Single concern: cache + LKG for the mirror. No business logic here.
 *
 * Shape:
 * - Mirror map keyed by "<slug>@<version>" → { serviceConfig: {...}, policies: { edge[], s2s[] } }
 * - Source tag: "db" | "lkg" (for observability)
 */

import type { Collection, WithId } from "mongodb";
import { promises as fs } from "fs";
import * as path from "path";
import { getLogger } from "@nv/shared/logger/Logger";
import { DbClient } from "@nv/shared/db/DbClient";
import { MirrorDbLoader, type MirrorMapV2 } from "./MirrorDbLoader.v2";

type SourceTag = "db" | "lkg";

export type MirrorSnapshotV2 = {
  map: MirrorMapV2;
  source: SourceTag;
  fetchedAt: string; // ISO
};

type LkgDoc = {
  _id: string; // fixed doc id, e.g., "mirror@v2"
  payload: MirrorMapV2; // the combined mirror
  updatedAt: string; // ISO
  schema: "mirror@v2"; // marker to avoid mixing versions
};

const LKG_COLL = "svcMirrorLkg";
const LKG_ID = "mirror@v2";

let _inMemory: MirrorSnapshotV2 | null = null;
let _expiresAt = 0;

type MirrorStoreCtor =
  | { ttlMs: number; loader: MirrorDbLoader; db?: DbClient; fsPath?: string }
  // Back-compat (old call sites passed `db` as required, no fs):
  | { ttlMs: number; loader: MirrorDbLoader; db: DbClient };

export class MirrorStoreV2 {
  private readonly log = getLogger().bind({
    service: "svcfacilitator",
    component: "MirrorStoreV2",
    url: "/services/mirrorStore.v2",
  });

  private readonly ttlMs: number;
  private readonly loader: MirrorDbLoader;

  // Filesystem LKG (primary)
  private readonly fsPath?: string;

  // DB LKG (secondary, optional)
  private readonly db?: DbClient;
  private _coll?: Collection<LkgDoc>;

  /**
   * DI: all dependencies provided by the owning service.
   * @param opts.ttlMs In-memory TTL (e.g., 5000)
   * @param opts.loader Pure DB loader (already compounded via repo)
   * @param opts.fsPath Optional absolute or CWD-relative filesystem path for LKG JSON
   * @param opts.db Optional DbClient for secondary LKG
   */
  constructor(opts: MirrorStoreCtor) {
    this.ttlMs = (opts as any).ttlMs;
    this.loader = (opts as any).loader;
    this.db = (opts as any).db;
    this.fsPath = (opts as any).fsPath;
  }

  // ── Public API (minimal) ───────────────────────────────────────────────────

  /** Return current in-memory map (empty object if none). */
  getMirror(): MirrorMapV2 {
    return _inMemory?.map ?? Object.create(null);
  }

  /** For diagnostics only — count of records currently in memory. */
  count(): number {
    return Object.keys(_inMemory?.map ?? {}).length;
  }

  /**
   * Replace in-memory mirror from a trusted push (e.g., gateway), and persist LKG.
   * - Writes LKG to FS (primary) and DB (secondary, best-effort) without env reads.
   * - Returns the resulting snapshot (source="db" because this is authoritative input).
   */
  async replaceWithPush(map: MirrorMapV2): Promise<MirrorSnapshotV2> {
    const snap: MirrorSnapshotV2 = {
      map: map ?? Object.create(null),
      source: "db",
      fetchedAt: new Date().toISOString(),
    };
    this.setInMemory(snap);
    await this.saveLkgBoth(snap.map, snap.fetchedAt);
    this.log.debug("SVF505 mirror_replaced_by_push", {
      count: Object.keys(snap.map).length,
    });
    return snap;
  }

  /**
   * Read-through getter with TTL and LKG fallback.
   * Order: In-Memory (fresh) → DB loader → FS LKG → DB LKG → empty
   */
  async getWithTtl(): Promise<MirrorSnapshotV2> {
    const now = Date.now();
    if (_inMemory && now < _expiresAt) {
      return _inMemory;
    }

    // Try DB (live)
    try {
      this.log.debug("SVF500 mirror_refresh_start", { strategy: "db" });
      const res = await this.loader.loadFullMirror();
      if (res && res.activeCount > 0) {
        const snap: MirrorSnapshotV2 = {
          map: res.mirror,
          source: "db",
          fetchedAt: new Date().toISOString(),
        };
        this.setInMemory(snap);
        await this.saveLkgBoth(snap.map, snap.fetchedAt);
        this.log.debug("SVF510 mirror_refresh_ok", {
          source: "db",
          activeCount: Object.keys(snap.map).length,
        });
        return snap;
      }
      this.log.warn("SVF520 mirror_refresh_empty", { source: "db" });
    } catch (err) {
      this.log.warn("SVF525 mirror_refresh_db_error", {
        error: String(err),
      });
    }

    // Fallback 1: Filesystem LKG
    try {
      const fsLkg = await this.loadFsLkg();
      if (fsLkg) {
        const snap: MirrorSnapshotV2 = {
          map: fsLkg.payload,
          source: "lkg",
          fetchedAt: fsLkg.updatedAt,
        };
        this.setInMemory(snap);
        this.log.warn("SVF531 mirror_fs_lkg_served", {
          count: Object.keys(snap.map).length,
          path: this.fsPath,
        });
        return snap;
      }
    } catch (err) {
      this.log.warn("SVF532 mirror_fs_lkg_error", { error: String(err) });
    }

    // Fallback 2: DB LKG (optional)
    try {
      const dbLkg = await this.loadDbLkg();
      if (dbLkg) {
        const snap: MirrorSnapshotV2 = {
          map: dbLkg.payload,
          source: "lkg",
          fetchedAt: dbLkg.updatedAt,
        };
        this.setInMemory(snap);
        this.log.warn("SVF533 mirror_db_lkg_served", {
          count: Object.keys(snap.map).length,
        });
        return snap;
      }
    } catch (err) {
      this.log.warn("SVF534 mirror_db_lkg_error", { error: String(err) });
    }

    // Nothing to serve — return empty but well-formed snapshot
    const empty: MirrorSnapshotV2 = {
      map: Object.create(null),
      source: "lkg",
      fetchedAt: new Date().toISOString(),
    };
    this.setInMemory(empty);
    this.log.warn("SVF540 mirror_empty_snapshot", { reason: "no_db_no_lkg" });
    return empty;
  }

  // ── Internals: cache + LKG helpers ─────────────────────────────────────────

  private setInMemory(snap: MirrorSnapshotV2): void {
    _inMemory = snap;
    _expiresAt = Date.now() + Math.max(0, this.ttlMs || 0);
  }

  // ----- Filesystem LKG (primary) -----

  private async saveFsLkg(map: MirrorMapV2, whenIso: string): Promise<void> {
    if (!this.fsPath) return; // optional
    const abs = path.isAbsolute(this.fsPath)
      ? this.fsPath
      : path.resolve(process.cwd(), this.fsPath);

    const payload = JSON.stringify(
      { schema: "mirror@v2", updatedAt: whenIso, payload: map },
      null,
      2
    );

    const dir = path.dirname(abs);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${abs}.tmp.${Date.now()}`;
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, abs);
  }

  private async loadFsLkg(): Promise<{
    payload: MirrorMapV2;
    updatedAt: string;
  } | null> {
    if (!this.fsPath) return null;
    const abs = path.isAbsolute(this.fsPath)
      ? this.fsPath
      : path.resolve(process.cwd(), this.fsPath);
    try {
      const data = await fs.readFile(abs, "utf8");
      const obj = JSON.parse(data) as Partial<LkgDoc>;
      if (
        obj &&
        (obj as any).schema === "mirror@v2" &&
        obj.payload &&
        obj.updatedAt
      ) {
        return {
          payload: obj.payload as MirrorMapV2,
          updatedAt: String(obj.updatedAt),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  // ----- DB LKG (secondary) -----

  private async coll(): Promise<Collection<LkgDoc> | null> {
    if (!this.db) return null;
    if (this._coll) return this._coll;
    const c = (await this.db.getCollection<LkgDoc>(
      LKG_COLL
    )) as Collection<LkgDoc>;
    this._coll = c;
    // No indexes needed beyond the fixed _id; keep it boring.
    return c;
  }

  private async saveDbLkg(map: MirrorMapV2, whenIso: string): Promise<void> {
    const c = await this.coll();
    if (!c) return;
    const doc: LkgDoc = {
      _id: LKG_ID,
      payload: map,
      updatedAt: whenIso,
      schema: "mirror@v2",
    };
    await c.updateOne({ _id: LKG_ID }, { $set: doc }, { upsert: true });
  }

  private async loadDbLkg(): Promise<WithId<LkgDoc> | null> {
    const c = await this.coll();
    if (!c) return null;
    const doc = await c.findOne({ _id: LKG_ID });
    if (!doc) return null;
    if (doc.schema !== "mirror@v2") return null; // wrong version, ignore
    if (!doc.payload || typeof doc.payload !== "object") return null;
    return doc as WithId<LkgDoc>;
  }

  // ----- Composite helpers -----

  private async saveLkgBoth(map: MirrorMapV2, whenIso: string): Promise<void> {
    // Filesystem first (primary), then DB (secondary, best-effort)
    try {
      await this.saveFsLkg(map, whenIso);
    } catch (e) {
      this.log.warn("SVF536 mirror_fs_lkg_write_error", { error: String(e) });
    }
    try {
      await this.saveDbLkg(map, whenIso);
    } catch (e) {
      this.log.warn("SVF537 mirror_db_lkg_write_error", { error: String(e) });
    }
  }
}
