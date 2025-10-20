// backend/services/svcfacilitator/src/boot/boot.hydrate.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *
 * Purpose:
 * - Orchestrate boot-time hydration using:
 *     1) MirrorDbLoader (reads entire collection; strict-parse; per-record errs)
 *     2) MirrorLkgStore  (atomic LKG save/load)
 *
 * Invariance:
 * - No env fallbacks. Fail-fast elsewhere; here we only snapshot presence.
 * - No console.* — structured logger only.
 */

import os from "os";
import { randomUUID } from "crypto";
import { getLogger } from "@nv/shared/logger/Logger";
import { mirrorStore } from "../services/mirrorStore";
import { MirrorLkgStore } from "../services/MirrorLkgStore";
import { MirrorDbLoader } from "../services/MirrorDbLoader";

const SERVICE = "svcfacilitator";
const VERSION = 1;

export class MirrorHydrator {
  private readonly log = getLogger().bind({
    slug: SERVICE,
    version: VERSION,
    url: "/boot/hydrate",
  });

  private readonly lkg = new MirrorLkgStore();
  private readonly loader = new MirrorDbLoader();

  async hydrate(): Promise<void> {
    const bootId = randomUUID();
    const bootStart = Date.now();

    this.log.debug("SVF100 boot_start", { pid: process.pid, bootId });
    this.log.debug("SVF110 env_validated", this.envSnapshot());

    // 1) Try DB (entire collection, no pre-filter)
    const res = await this.loader.loadFullMirror();
    if (res && res.activeCount > 0) {
      const { mirror, rawCount, activeCount, errors } = res;

      mirrorStore.setMirror(mirror);

      // best-effort persist
      this.lkg.save(mirror, {
        requestId: bootId,
        rawCount,
        activeCount,
        invalidCount: errors.length,
      });

      if (errors.length > 0) {
        this.log.warn("SVF415 mirror_partial", {
          rawCount,
          activeCount,
          invalidCount: errors.length,
          examples: errors.slice(0, 5),
        });
      }

      const duration = Date.now() - bootStart;
      this.log.info("SVF700 ready", {
        count: activeCount,
        source: "db",
        warmed: true,
        durationMs: duration,
        host: os.hostname(),
      });
      return;
    }

    // 2) Fall back to LKG
    const lkgMirror = this.lkg.tryLoad();
    if (lkgMirror && Object.keys(lkgMirror).length > 0) {
      mirrorStore.setMirror(lkgMirror);

      const duration = Date.now() - bootStart;
      this.log.info("SVF700 ready", {
        count: Object.keys(lkgMirror).length,
        source: "lkg",
        warmed: true,
        durationMs: duration,
        host: os.hostname(),
      });
      return;
    }

    // 3) Nothing usable → fail-fast per SOP
    const duration = Date.now() - bootStart;
    this.log.error("SVF710 not_ready", {
      reason: "no_db_no_lkg",
      durationMs: duration,
    });
    throw new Error("SvcFacilitator boot failed: no DB configs and empty LKG");
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private envSnapshot() {
    // Presence-only snapshot (no implied defaults or fallbacks)
    const mongoHost = (() => {
      try {
        const u = process.env.SVCCONFIG_MONGO_URI?.trim();
        return u ? new URL(u).host : null;
      } catch {
        return null;
      }
    })();

    return {
      required: [
        "SVCCONFIG_LKG_PATH",
        "SVCCONFIG_MONGO_URI",
        "SVCCONFIG_MONGO_DB",
        "SVCCONFIG_MONGO_COLLECTION",
      ],
      present: {
        SVCCONFIG_LKG_PATH: Boolean(process.env.SVCCONFIG_LKG_PATH),
        SVCCONFIG_MONGO_URI: Boolean(process.env.SVCCONFIG_MONGO_URI),
        SVCCONFIG_MONGO_DB: Boolean(process.env.SVCCONFIG_MONGO_DB),
        SVCCONFIG_MONGO_COLLECTION: Boolean(
          process.env.SVCCONFIG_MONGO_COLLECTION
        ),
        LOG_LEVEL: Boolean(process.env.LOG_LEVEL),
      },
      mongoHost,
    };
  }
}

/** Back-compat functional wrapper for existing preStart hook. */
export async function preStartHydrateMirror(): Promise<void> {
  await new MirrorHydrator().hydrate();
}
