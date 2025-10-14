// backend/services/shared/src/writer/HttpAuditWriter.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - HTTP-based audit writer that ships WAL batches to the Audit service via shared SvcClient.
 * - Pure I/O; no env reads, no schema logic. Idempotency handled upstream/downstream.
 *
 * Contract:
 * - Implements IAuditWriter.writeBatch(batch) → Promise<void>.
 * - Throws on failure; WAL retains entries for replay. Safe for duplicate sends.
 *
 * Notes:
 * - Caller injects a SvcClient-like object (duck-typed) so we avoid guessing import paths.
 * - Route defaults to "/entries" under /api/<slug>/v<version>.
 * - Retries on transient errors with fixed backoff.
 */

import type { AuditBlob } from "../../contracts/audit/audit.blob.contract";
import type { IAuditWriter } from "./IAuditWriter";

type HttpMethod = "POST";

type SvcClientLike = {
  /**
   * Call another service by slug/version.
   * Must mint S2S JWT internally; caller (this writer) never forwards client auth.
   *
   * Example impl signature (duck-typed):
   *   callBySlug<TReq, TRes>(
   *     slug: string,
   *     version: number,
   *     route: string,
   *     method: HttpMethod,
   *     message: TReq,
   *     options?: { timeoutMs?: number }
   *   ): Promise<TRes>;
   */
  callBySlug: <TReq, TRes>(
    slug: string,
    version: number,
    route: string,
    method: HttpMethod,
    message: TReq,
    options?: { timeoutMs?: number }
  ) => Promise<TRes>;
};

export interface HttpAuditWriterOptions {
  /** Injected SvcClient (or compatible) instance for S2S calls. */
  svcClient: SvcClientLike;

  /** Target Audit service slug, e.g., "audit". */
  auditSlug: string;

  /** Target Audit service major version, e.g., 1. */
  auditVersion: number;

  /**
   * Ingest route (mounted under /api/<slug>/v<version>).
   * Defaults to "/entries" → POST /api/audit/v1/entries
   */
  route?: string;

  /** Per-call timeout in ms (default: 5000). */
  timeoutMs?: number;

  /** Retry attempts on transient failures (default: 3). */
  retries?: number;

  /** Fixed backoff between retries in ms (default: 250). */
  backoffMs?: number;
}

export class HttpAuditWriter implements IAuditWriter {
  private readonly svcClient: SvcClientLike;
  private readonly slug: string;
  private readonly ver: number;
  private readonly route: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;

  constructor(opts: HttpAuditWriterOptions) {
    if (!opts?.svcClient)
      throw new Error("HttpAuditWriter: svcClient is required");
    if (!opts.auditSlug)
      throw new Error("HttpAuditWriter: auditSlug is required");
    if (typeof opts.auditVersion !== "number")
      throw new Error("HttpAuditWriter: auditVersion is required");

    this.svcClient = opts.svcClient;
    this.slug = opts.auditSlug;
    this.ver = opts.auditVersion;
    this.route = opts.route ?? "/entries";
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.retries = Math.max(0, opts.retries ?? 3);
    this.backoffMs = Math.max(0, opts.backoffMs ?? 250);
  }

  public async writeBatch(batch: ReadonlyArray<AuditBlob>): Promise<void> {
    // Defensive: avoid accidental mutation by callers after invocation
    const payload: ReadonlyArray<AuditBlob> = Array.isArray(batch)
      ? batch.slice()
      : [];

    if (payload.length === 0) {
      // No-op: nothing to send, and not an error.
      return;
    }

    let attempt = 0;
    // lastError captured for context if we exhaust retries
    let lastError: unknown;

    while (attempt <= this.retries) {
      try {
        await this.svcClient.callBySlug<ReadonlyArray<AuditBlob>, unknown>(
          this.slug,
          this.ver,
          this.route,
          "POST",
          payload,
          { timeoutMs: this.timeoutMs }
        );
        // Success
        return;
      } catch (err: any) {
        lastError = err;
        // Decide if retryable: network/5xx/timeouts are typical retry cases.
        if (!this.isRetryable(err) || attempt === this.retries) {
          // Give up
          const detail = this.describeError(err);
          throw new Error(
            `HttpAuditWriter: failed to post batch after ${
              attempt + 1
            } attempt(s): ${detail}`
          );
        }
        // Backoff then retry
        await this.sleep(this.backoffMs);
        attempt++;
      }
    }
  }

  private isRetryable(err: any): boolean {
    // Heuristic: treat typical transient conditions as retryable.
    const code = err?.code ?? err?.cause?.code;
    const status = err?.status ?? err?.response?.status;

    if (typeof status === "number" && status >= 500) return true; // 5xx
    if (code && typeof code === "string") {
      const c = code.toUpperCase();
      if (
        c === "ECONNRESET" ||
        c === "ETIMEDOUT" ||
        c === "EAI_AGAIN" ||
        c === "ECONNREFUSED" ||
        c === "ENETUNREACH" ||
        c === "EHOSTUNREACH"
      ) {
        return true;
      }
    }
    // Timeouts often surface differently; conservatively retry if message hints at timeout.
    const msg: string | undefined = err?.message ?? err?.toString?.();
    if (msg && /timeout/i.test(msg)) return true;

    return false;
  }

  private describeError(err: any): string {
    const parts: string[] = [];
    if (err?.message) parts.push(err.message);
    const status = err?.status ?? err?.response?.status;
    if (status) parts.push(`status=${status}`);
    const code = err?.code ?? err?.cause?.code;
    if (code) parts.push(`code=${code}`);
    return parts.join(" ");
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((r) => setTimeout(r, ms));
  }
}
