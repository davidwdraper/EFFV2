// backend/services/svcfacilitator/src/services/mirrorStore.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/services/mirrorStore.v2.ts
 *
 * Docs:
 * - SOP: Reduced, Clean — environment invariance; fail fast; no hidden defaults
 * - ADR-0007: SvcConfig Contract (wire schema)
 * - ADR-0020: Mirror & Push (DB → Mirror → LKG(fs); fallback LKG(fs) → Mirror)
 *
 * Purpose:
 * - Hold the in-memory Mirror snapshot with TTL refresh.
 * - Persist/restore **filesystem LKG** only (no DB LKG).
 * - Validate FS LKG against the canonical wire schema **before** serving.
 *
 * Invariants:
 * - No env reads here (fsPath injected). No Zod outside of the wire schema.
 * - First line of defense: load from DB; else valid FS LKG; else loud fail on cold start.
 * - Orchestration only — no business logic.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { getLogger } from "@nv/shared/logger/Logger";
import { MirrorDbLoader } from "./MirrorDbLoader.v2";
import {
  MirrorJSON,
  MirrorJSONSchema,
} from "@nv/shared/contracts/serviceConfig.wire";

type SourceTag = "db" | "lkg";

export class ColdStartNoDbNoLkgError extends Error {
  constructor() {
    super("Cold start failed: DB unavailable and no FS LKG present");
    this.name = "ColdStartNoDbNoLkgError";
  }
}

export type MirrorSnapshotV2 = {
  map: MirrorJSON;
  source: SourceTag;
  fetchedAt: string; // ISO
};

type LkgDoc = {
  schema: "mirror@v2";
  updatedAt: string; // ISO
  payload: MirrorJSON; // canonical wire shape
};

let _inMemory: MirrorSnapshotV2 | null = null;
let _expiresAt = 0;

type MirrorStoreCtor = {
  ttlMs: number;
  loader: MirrorDbLoader;
  fsPath?: string; // absolute or cwd-relative path to LKG JSON file
};

export class MirrorStoreV2 {
  private readonly log = getLogger().bind({
    service: "svcfacilitator",
    component: "MirrorStoreV2",
    url: "/services/mirrorStore.v2",
  });

  private readonly ttlMs: number;
  private readonly loader: MirrorDbLoader;
  private readonly fsPath?: string;

  constructor(opts: MirrorStoreCtor) {
    this.ttlMs = opts.ttlMs;
    this.loader = opts.loader;
    this.fsPath = opts.fsPath;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Return current in-memory mirror (empty object if none). */
  getMirror(): MirrorJSON {
    return _inMemory?.map ?? Object.create(null);
  }

  /** Diagnostic: count of services currently in memory. */
  count(): number {
    return Object.keys(_inMemory?.map ?? {}).length;
  }

  /**
   * Replace in-memory mirror from a trusted push (e.g., gateway) and persist FS LKG.
   * Returns the resulting snapshot.
   */
  async replaceWithPush(map: MirrorJSON): Promise<MirrorSnapshotV2> {
    const snap: MirrorSnapshotV2 = {
      map: map ?? Object.create(null),
      source: "db",
      fetchedAt: new Date().toISOString(),
    };
    this.setInMemory(snap);
    await this.saveFsLkg(snap.map, snap.fetchedAt);
    this.log.debug("SVF505 mirror_replaced_by_push", {
      count: Object.keys(snap.map).length,
    });
    return snap;
  }

  /**
   * Read-through with TTL:
   *   In-Memory (fresh) → DB → FS LKG (validated) → loud fail on true cold start.
   */
  async getWithTtl(): Promise<MirrorSnapshotV2> {
    const now = Date.now();
    if (_inMemory && now < _expiresAt) {
      return _inMemory;
    }

    // 1) DB (source of truth)
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
        await this.saveFsLkg(snap.map, snap.fetchedAt);
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

    // 2) FS LKG (must pass wire schema)
    try {
      const fsLkg = await this.loadFsLkgValidated();
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

    // 3) Neither DB nor valid LKG → hard fail on true cold start
    this.log.error("SVF541 cold_start_no_db_no_lkg");
    throw new ColdStartNoDbNoLkgError();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private setInMemory(snap: MirrorSnapshotV2): void {
    _inMemory = snap;
    _expiresAt = Date.now() + Math.max(0, this.ttlMs || 0);
  }

  // ----- Filesystem LKG (primary persistence) -----

  private async saveFsLkg(map: MirrorJSON, whenIso: string): Promise<void> {
    if (!this.fsPath) return; // optional
    const abs = path.isAbsolute(this.fsPath)
      ? this.fsPath
      : path.resolve(process.cwd(), this.fsPath);

    const payload = JSON.stringify(
      {
        schema: "mirror@v2",
        updatedAt: whenIso,
        payload: map,
      } satisfies LkgDoc,
      null,
      2
    );

    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp.${Date.now()}`;
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, abs);
  }

  /**
   * Accept both the wrapped LKG doc shape ({schema, updatedAt, payload})
   * and the legacy/plain MirrorJSON map written by external tools.
   * Always validate against MirrorJSONSchema before returning.
   */
  private async loadFsLkgValidated(): Promise<LkgDoc | null> {
    if (!this.fsPath) return null;
    const abs = path.isAbsolute(this.fsPath)
      ? this.fsPath
      : path.resolve(process.cwd(), this.fsPath);

    try {
      // Read and parse file
      const data = await fs.readFile(abs, "utf8");
      const raw: unknown = JSON.parse(data);

      // Case A: wrapped LKG doc
      if (
        raw &&
        typeof raw === "object" &&
        (raw as any).schema === "mirror@v2" &&
        (raw as any).payload &&
        (raw as any).updatedAt
      ) {
        const parsed = MirrorJSONSchema.safeParse((raw as any).payload);
        if (!parsed.success) {
          const first = parsed.error.issues?.[0];
          const at = first?.path?.join(".") || "<root>";
          throw new Error(
            `FS LKG failed schema validation at ${at}: ${first?.message}`
          );
        }
        return {
          schema: "mirror@v2",
          updatedAt: String((raw as any).updatedAt),
          payload: parsed.data as MirrorJSON,
        };
      }

      // Case B: plain MirrorJSON map (legacy/external writer)
      const parsedPlain = MirrorJSONSchema.safeParse(raw);
      if (parsedPlain.success) {
        // Try to use file mtime as updatedAt; fallback to now
        let updatedAt = new Date().toISOString();
        try {
          const stat = await fs.stat(abs);
          updatedAt = stat.mtime.toISOString();
        } catch {
          /* ignore; default to now */
        }
        return {
          schema: "mirror@v2",
          updatedAt,
          payload: parsedPlain.data as MirrorJSON,
        };
      }

      // Neither shape validated
      return null;
    } catch (err) {
      // Corrupt/partial/unreadable LKG — treat as absent
      this.log.warn("SVF533 mirror_fs_lkg_read_error", {
        path: this.fsPath,
        error: String(err),
      });
      return null;
    }
  }
}
