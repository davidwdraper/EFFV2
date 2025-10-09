// backend/services/gateway/src/services/audit/GatewayAuditService.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *   - ADR-0022 (Shared WAL & DB Base; environment invariance)
 *   - ADR-0024 (SvcClient/SvcReceiver refactor for S2S)
 *
 * Purpose:
 * - Gateway-local audit client that buffers "begin" / "end" events in a shared WAL
 *   and periodically POSTs batches to the Audit service via SvcClient.
 *
 * Invariance:
 * - FS journaling is mandatory (WAL_DIR required; no off switch).
 * - Routing uses AUDIT_SLUG (e.g., "audit@1") resolved by SvcClient’s UrlResolver.
 * - No URL literals. Dev == Prod.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Wal, type WalEntry } from "@nv/shared/wal/Wal";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import type { SvcClient } from "@nv/shared/svc/SvcClient";

/* ------------------------------------------------------------------------- */

export interface GatewayAuditServiceOptions {
  logger: IBoundLogger; // pass this.bindLog({ component: "GatewayAuditService" }) or this.log
  svc: SvcClient; // DI: shared S2S client already wired with UrlResolver
  flushIntervalMs?: number; // optional; else GW_AUDIT_FLUSH_MS or 1000
  wal?: Wal; // test seam
  enrich?: Record<string, unknown>;
}

export class GatewayAuditService {
  private readonly log: IBoundLogger;
  private readonly svc: SvcClient;
  private readonly wal: Wal;
  private readonly enrich: Record<string, unknown>;
  private isRunning = false;
  private loop?: NodeJS.Timeout;
  private flushEveryMs: number;
  private readonly slug: string;
  private readonly version: number;

  public constructor(opts: GatewayAuditServiceOptions) {
    this.log = opts.logger;
    this.svc = opts.svc;

    // ---- Parse required AUDIT_SLUG (e.g., "audit@1") ----
    const rawSlug = process.env.AUDIT_SLUG;
    if (!rawSlug)
      throw new Error("[gateway.audit] AUDIT_SLUG required (e.g., audit@1)");
    const [name, verStr] = rawSlug.split("@");
    const ver = Number.parseInt(verStr, 10);
    if (!name || !Number.isFinite(ver)) {
      throw new Error(`[gateway.audit] Invalid AUDIT_SLUG: "${rawSlug}"`);
    }
    this.slug = name;
    this.version = ver;

    // ---- WAL (mandatory FS; Wal.fromEnv fails if WAL_DIR missing) ----
    this.wal =
      opts.wal ??
      Wal.fromEnv({
        logger: this.log,
        defaults: { flushIntervalMs: 0, maxInMemory: 1000 },
      });

    const envFlush = process.env.GW_AUDIT_FLUSH_MS
      ? Number.parseInt(process.env.GW_AUDIT_FLUSH_MS, 10)
      : NaN;
    this.flushEveryMs = Number.isFinite(envFlush)
      ? envFlush
      : opts.flushIntervalMs ?? 1000;

    this.enrich = opts.enrich ?? {};
  }

  /** Start periodic flushing (SvcClient → audit@v /entries). Idempotent. */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop = setInterval(() => {
      void this.flush().catch((err) =>
        this.log.warn("[gateway.audit] flush_error", { err: String(err) })
      );
    }, this.flushEveryMs);
    this.log.info("[gateway.audit] started", {
      flushEveryMs: this.flushEveryMs,
    });
  }

  public stop(): void {
    if (!this.isRunning) return;
    clearInterval(this.loop!);
    this.loop = undefined;
    this.isRunning = false;
    this.log.info("[gateway.audit] stopped");
  }

  public recordBegin(
    req: IncomingMessage & { headers: Record<string, any> }
  ): void {
    const now = Date.now();
    this.wal.append({
      kind: "audit",
      phase: "begin",
      service: "gateway",
      time: now,
      requestId: this.reqId(req),
      method: (req as any).method,
      url: (req as any).url,
      ip: this.ip(req),
      headers: this.safeHeaders(req),
      ...this.enrich,
    });
  }

  public recordEnd(
    req: IncomingMessage & { headers: Record<string, any> },
    res: ServerResponse & { statusCode?: number }
  ): void {
    const now = Date.now();
    this.wal.append({
      kind: "audit",
      phase: "end",
      service: "gateway",
      time: now,
      requestId: this.reqId(req),
      method: (req as any).method,
      url: (req as any).url,
      status: res.statusCode ?? 0,
      ...this.enrich,
    });
  }

  /** Drain WAL via SvcClient to the Audit service. */
  public async flush(): Promise<void> {
    await this.wal.flush(async (batch) => {
      if (batch.length === 0) return;

      const resp = await this.svc.call({
        slug: this.slug,
        version: this.version,
        path: `/api/${this.slug}/v${this.version}/entries`,
        method: "POST",
        body: { entries: batch },
        // No client Authorization forwarding; SvcClient/SvcReceiver will handle S2S later.
      });

      if (!resp.ok) {
        const statusText = String(resp.error?.message ?? "upstream_error");
        throw new Error(`Audit POST failed: ${resp.status} — ${statusText}`);
      }
    });
  }

  /* ------------------------------ helpers -------------------------------- */

  private reqId(
    req: IncomingMessage & { headers: Record<string, any> }
  ): string {
    const h = req.headers || {};
    return (
      (h["x-request-id"] as string) ||
      (h["x-requestid"] as string) ||
      (h["x_request_id"] as string) ||
      ""
    );
  }

  private ip(
    req: IncomingMessage & { headers: Record<string, any> }
  ): string | undefined {
    const xf = (req.headers?.["x-forwarded-for"] as string) || "";
    if (xf) return xf.split(",")[0]?.trim();
    return req.socket?.remoteAddress || req.connection?.remoteAddress;
  }

  private safeHeaders(
    req: IncomingMessage & { headers: Record<string, any> }
  ): Record<string, unknown> {
    const h: Record<string, unknown> = { ...req.headers };
    delete (h as any).authorization;
    delete (h as any).Authorization;
    return h;
  }
}
