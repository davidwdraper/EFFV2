// backend/services/shared/src/writer/HttpAuditWriter.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0027 — SvcClient/SvcReceiver S2S Contract (baseline, pre-auth)
 *
 * Purpose:
 * - HTTP-based audit writer that ships WAL batches to the Audit service via shared SvcClient.
 * - Pure I/O; no env reads, no schema logic. Idempotency handled upstream/downstream.
 *
 * Contract:
 * - Implements IAuditWriter.writeBatch(batch) → Promise<void>.
 * - Throws on failure; WAL retains entries for replay. Safe for duplicate sends.
 */

import type { AuditBlob } from "../../contracts/audit/audit.blob.contract";
import { AuditEntriesV1Contract } from "../../contracts/audit/audit.entries.v1.contract";
import type { IAuditWriter } from "./IAuditWriter";
import type { SvcCallOptions, SvcResponse } from "../../svc/types";

// Duck-typed SvcClient dependency — matches SvcClient.call(opts).
type SvcClientLike = {
  call<T = unknown>(opts: SvcCallOptions): Promise<SvcResponse<T>>;
};

export interface HttpAuditWriterOptions {
  svcClient: SvcClientLike;
  auditSlug: string; // e.g., "audit"
  auditVersion: number; // e.g., 1
  route?: string; // service-local path, defaults to "/entries"
  timeoutMs?: number; // default 5000
  retries?: number; // default 3
  backoffMs?: number; // default 250
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
    this.route = opts.route ?? "/entries"; // service-local path (resolver composes /api/<slug>/v<ver>)
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.retries = Math.max(0, opts.retries ?? 3);
    this.backoffMs = Math.max(0, opts.backoffMs ?? 250);
  }

  public async writeBatch(batch: ReadonlyArray<AuditBlob>): Promise<void> {
    const payload: ReadonlyArray<AuditBlob> = Array.isArray(batch)
      ? batch.slice()
      : [];
    if (payload.length === 0) return;

    const contractId = AuditEntriesV1Contract.getContractId(); // "audit/entries@v1"

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.retries) {
      try {
        await this.svcClient.call({
          slug: this.slug,
          version: this.ver,
          path: this.route, // service-local
          method: "POST",
          body: { entries: payload }, // 🔧 canonical request body shape
          timeoutMs: this.timeoutMs,
          headers: {
            // 🔧 required contract header
            "X-NV-Contract": contractId,
          },
        });
        return; // success
      } catch (err: any) {
        lastError = err;
        if (!this.isRetryable(err) || attempt === this.retries) {
          const detail = this.describeError(err);
          throw new Error(
            `HttpAuditWriter: failed to post batch after ${
              attempt + 1
            } attempt(s): ${detail}`
          );
        }
        await this.sleep(this.backoffMs);
        attempt++;
      }
    }

    // If we ever exit the loop without returning/throwing (shouldn't happen), throw last error.
    if (lastError) throw lastError;
  }

  private isRetryable(err: any): boolean {
    const status = err?.status ?? err?.response?.status;
    if (typeof status === "number" && status >= 500) return true;

    const code = (err?.code ?? err?.cause?.code)?.toString().toUpperCase?.();
    if (
      code &&
      [
        "ECONNRESET",
        "ETIMEDOUT",
        "EAI_AGAIN",
        "ECONNREFUSED",
        "ENETUNREACH",
        "EHOSTUNREACH",
      ].includes(code)
    ) {
      return true;
    }

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
