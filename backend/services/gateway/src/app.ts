// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0001 (Gateway-Embedded SvcConfig mirror)
 *   - ADR-0003 (Gateway pulls svc map from svcfacilitator)
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *   - ADR-0013 (Versioned Health — local, never proxied)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0022 (Shared WAL & DB Base; environment invariance)
 *   - ADR-0024 (SvcClient/SvcReceiver refactor for S2S)
 *   - adr0023-wal-writer-reader-split
 *
 * Purpose:
 * - Health first, then edge logs, then audit logger, then proxy, then error funnel.
 * - No endpoint guessing: SvcClient resolves slug@version via SvcConfig.
 * - Audit batching is owned locally (GatewayAuditService) with mandatory FS WAL.
 * - WalReplayer re-emits LDJSON WAL to Audit when it becomes reachable again.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { edgeHitLogger } from "./middleware/edge.hit.logger";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";
import { ProxyRouter } from "./routes/proxy.router";
import { auditLogger } from "./middleware/audit.logger";
import { GatewayAuditService } from "./services/audit/GatewayAuditService";
import { SvcClient } from "@nv/shared/svc/SvcClient";
import { WalReplayer } from "@nv/shared/wal/WalReplayer";
import { AuditEntryContract } from "@nv/shared/contracts/audit/audit.entry.contract";

const SERVICE = "gateway";

/** Fail-fast env accessors (env invariance; no literals, no defaults). */
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`[${SERVICE}] missing required env: ${name}`);
  return v;
}
function intEnv(name: string): number {
  const n = Number(mustEnv(name));
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`[${SERVICE}] env ${name} must be a positive number`);
  return n;
}
/** Normalize slug env: strip any accidental "@<version>" suffix */
function normalizeSlug(raw: string): string {
  return raw.split("@")[0]?.trim();
}

export class GatewayApp extends AppBase {
  private svcConfig?: SvcConfig;
  private audit?: GatewayAuditService;
  private replayer?: WalReplayer;

  constructor() {
    super({ service: SERVICE });
  }

  protected onBoot(): void {
    const sc = (this.svcConfig ??= getSvcConfig());

    // Warm SvcConfig (failures are logged, readiness gate will still protect /api)
    void sc.ensureLoaded().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gateway] svcconfig warm-load failed:", String(err));
    });

    // ---- Shared SvcClient using SvcConfig public API (no duck-typing) ----
    const svc = new SvcClient(async (slug, version) => {
      if (version === undefined || version === null) {
        throw new Error(`[gateway] missing version for slug="${slug}"`);
      }
      try {
        return sc.getUrlFromSlug(slug, version);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`[gateway] ${msg}`);
      }
    });

    // ---- Gateway-local audit batching (FS WAL mandatory; enforced in Wal.fromEnv) ----
    const gwLog = this.bindLog({ component: "GatewayAuditService" });
    this.audit = new GatewayAuditService({
      logger: gwLog,
      svc, // ← canonical S2S path (SvcClient → SvcReceiver)
    });
    this.audit.start();

    // ---- WalReplayer: drain gateway WAL to Audit when reachable ----
    const rl = this.bindLog({ component: "WalReplayer" });
    const auditSlug = normalizeSlug(mustEnv("AUDIT_SLUG")); // ensure plain "audit"
    this.replayer = new WalReplayer({
      walDir: mustEnv("WAL_DIR"),
      cursorPath: mustEnv("WAL_CURSOR_FILE"),
      batchLines: intEnv("WAL_REPLAY_BATCH_LINES"),
      batchBytes: intEnv("WAL_REPLAY_BATCH_BYTES"),
      tickMs: intEnv("WAL_REPLAY_TICK_MS"),
      logger: rl,
      onBatch: async (lines: string[]) => {
        // Strictly parse each line as an AuditEntry; drop anything malformed.
        const entries: any[] = [];
        for (const l of lines) {
          let obj: unknown;
          try {
            obj = JSON.parse(l);
          } catch {
            continue; // skip non-JSON
          }
          try {
            const parsed = AuditEntryContract.parse(obj, "gateway.replay");
            entries.push(parsed.toJSON());
          } catch {
            // Not an audit entry or invalid (e.g., bad ts). Skip it.
            // This prevents poisoning the whole POST with a 400.
            continue;
          }
        }
        if (entries.length === 0) return;

        const resp = await svc.call({
          slug: auditSlug, // must be "audit"
          version: 1, // version here, not in slug
          path: "/api/audit/v1/entries", // versioned route
          method: "POST",
          body: { entries },
        });

        if (!resp.ok) {
          const statusText = String(resp.error?.message ?? "upstream_error");
          // NOTE: SvcResponse has no `url` property; keep the error concise and accurate.
          throw Object.assign(
            new Error(
              `s2s_upstream_error ${resp.status} POST /api/audit/v1/entries (slug=${auditSlug}@v1): ${statusText}`
            ),
            { __wal_context: { count: entries.length } }
          );
        }
      },
    });
    this.replayer.start();
  }

  protected healthBasePath(): string | null {
    return "/api/gateway/v1";
  }

  protected readyCheck(): () => boolean {
    return () => {
      try {
        return (this.svcConfig ?? getSvcConfig()).count() > 0;
      } catch {
        return false;
      }
    };
  }

  protected mountPreRouting(): void {
    super.mountPreRouting();
    // Required order: edge → audit → (future: s2s guards) → proxy
    this.app.use(edgeHitLogger());
    if (!this.audit) throw new Error("[gateway] audit service not initialized");
    this.app.use(auditLogger(this.audit));
  }

  protected mountParsers(): void {
    // Intentionally empty — proxy streams bodies unchanged.
  }

  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());
    this.app.use("/api", new ProxyRouter(sc).router());
  }
}
