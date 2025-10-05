// backend/services/svcfacilitator/src/services/mirrorStore.ts
/**
 * Docs:
 * - SOP: svcfacilitator is the source of truth; gateway mirrors from it.
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *
 * Purpose:
 * - Minimal, in-memory store for the live svcconfig mirror.
 * - Stable API used by controllers and boot hydrator.
 *
 * Contract:
 * - Keys are "<slug>@<version>" (lowercase slug).
 * - Values are canonical, JSON-normalized ServiceConfigRecord documents.
 *
 * Notes:
 * - Single-process, in-memory. No cross-process sync.
 * - All writes are whole-mirror swaps (no partial merges).
 * - No console.* — logs via shared logger provider.
 */

import { getLogger } from "@nv/shared/util/logger.provider";
import type {
  ServiceConfigMirror,
  ServiceConfigRecordJSON,
} from "@nv/shared/contracts/svcconfig.contract";

type Mirror = ServiceConfigMirror;

class MirrorStore {
  private mirror: Mirror = {};
  private readonly log = getLogger().bind({
    slug: "svcfacilitator",
    version: 1,
    url: "/mirror/store",
  });

  /** Replace the entire mirror atomically. */
  public setMirror(next: Mirror): void {
    // Basic defensive copy to avoid external mutation
    this.mirror = { ...next };
    this.log.info(
      `mirror_swapped - services=${Object.keys(this.mirror).length}`
    );
  }

  /** Get a single record by "<slug>@<version>" key. */
  public get(key: string): ServiceConfigRecordJSON | undefined {
    return this.mirror[key];
  }

  /** Snapshot (shallow copy) of the current mirror for read-only use. */
  public snapshot(): Mirror {
    return { ...this.mirror };
  }

  /** Clear all entries (primarily for tests). */
  public clear(): void {
    this.mirror = {};
    this.log.warn("mirror_cleared");
  }

  /** Current size for health/debug. */
  public size(): number {
    return Object.keys(this.mirror).length;
  }

  /** List all keys (debug tooling). */
  public keys(): string[] {
    return Object.keys(this.mirror);
  }
}

export const mirrorStore = new MirrorStore();
