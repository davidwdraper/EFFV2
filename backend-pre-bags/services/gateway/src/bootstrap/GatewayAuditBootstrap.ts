// backend/services/gateway/src/bootstrap/GatewayAuditBootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0027 — SvcClient/SvcReceiver S2S Contract (baseline, pre-auth)
 *
 * Purpose:
 * - Single concern: wire gateway audit DI.
 *   - Read/validate env (via GatewayAuditEnv)
 *   - Create HttpAuditWriter with shared SvcClient
 *   - Build WAL & publish to app.locals
 *   - Optionally replay gateway WAL on boot
 *
 * Notes:
 * - No defaults: auditSlug and version come strictly from validated env vars.
 * - Writer is created with the shared SvcClient so outbound calls use the
 *   FacilitatorResolver → mirror → composed base (no hardcoded /api).
 * - If REPLAY_ON_BOOT is true, any persisted WAL entries are flushed to Audit
 *   before accepting traffic.
 */

import type { Express } from "express";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import { buildWal } from "@nv/shared/wal/WalBuilder";
import { HttpAuditWriter } from "@nv/shared/wal/writer/HttpAuditWriter";
import { CursorlessWalReplayer } from "@nv/shared/wal/replay/CursorlessWalReplayer";
import type { IAuditWriter } from "@nv/shared/wal/writer/IAuditWriter";
import type { SvcCallOptions, SvcResponse } from "@nv/shared/svc/types";
import { GatewayAuditEnv } from "./GatewayAuditEnv";
import { setTimeout as delay } from "node:timers/promises";

type SvcClientCompatible = {
  call<T = unknown>(opts: SvcCallOptions): Promise<SvcResponse<T>>;
};

export class GatewayAuditBootstrap {
  static async init(opts: {
    app: Express;
    log: IBoundLogger;
    svcClient: SvcClientCompatible;
  }): Promise<void> {
    const { app, log, svcClient } = opts;

    // ── 1. Read and validate environment ─────────────────────────────────────
    const { WAL_DIR, AUDIT_SLUG, AUDIT_SLUG_VERSION, REPLAY_ON_BOOT } =
      GatewayAuditEnv.read();

    // ── 2. Construct the HttpAuditWriter (uses shared SvcClient) ─────────────
    // Keep these values aligned with the replay wrapper below.
    const TIMEOUT_MS = 5000;
    const RETRIES = 3;
    const BACKOFF_BASE_MS = 250;

    const writer = new HttpAuditWriter({
      svcClient,
      auditSlug: AUDIT_SLUG,
      auditVersion: AUDIT_SLUG_VERSION,
      timeoutMs: TIMEOUT_MS,
      retries: RETRIES,
      backoffMs: BACKOFF_BASE_MS,
    });

    // ── 3. Build the WAL engine and attach to app.locals ─────────────────────
    const wal = await buildWal({
      journal: { dir: WAL_DIR },
      writer: { instance: writer },
    });

    (app.locals as any).wal = wal;
    (app.locals as any).WAL_DIR = WAL_DIR;

    // ── 4. Optional: replay persisted WAL entries on boot ────────────────────
    if (REPLAY_ON_BOOT) {
      try {
        const replayer = new CursorlessWalReplayer({ dir: WAL_DIR });

        // Adapter ensures type compatibility with IAuditWriter
        type BatchArg = Parameters<IAuditWriter["writeBatch"]>[0];

        // Outer retry wrapper specifically for boot replay to survive ECONNREFUSED / DNS races.
        const replayerWriter: IAuditWriter = {
          writeBatch: async (batch: BatchArg): Promise<void> => {
            let attempt = 0;
            // Use the same attempt count semantics the writer uses internally:
            // first try + (RETRIES - 1) retries == RETRIES total attempts.
            const maxAttempts = RETRIES;
            while (true) {
              attempt++;
              try {
                await writer.writeBatch(batch);
                return; // success
              } catch (err: any) {
                // If we’ve exhausted attempts, rethrow.
                if (attempt >= maxAttempts) {
                  throw err;
                }
                // Jittered exponential backoff (aligned with BACKOFF_BASE_MS).
                const backoff =
                  BACKOFF_BASE_MS * Math.pow(2, attempt - 1) +
                  Math.floor(Math.random() * 25);
                log.warn(
                  {
                    service: "gateway",
                    component: "GatewayAuditBootstrap",
                    attempt,
                    maxAttempts,
                    backoffMs: backoff,
                    err: err?.message || String(err),
                  },
                  "gateway_wal_replay_retry"
                );
                await delay(backoff);
              }
            }
          },
        };

        const stats = await replayer.replay(replayerWriter);

        log.info(
          {
            service: "gateway",
            component: "GatewayAuditBootstrap",
            ...stats, // filesScanned, linesScanned, batchesEmitted, blobsReplayed
            module: "@nv/shared/wal/replay/CursorlessWalReplayer",
          },
          "gateway_wal_replay_on_boot_completed"
        );
      } catch (err: any) {
        log.warn(
          {
            service: "gateway",
            component: "GatewayAuditBootstrap",
            err: err?.message || String(err),
          },
          "gateway_wal_replay_on_boot_failed"
        );
      }
    }
  }
}
