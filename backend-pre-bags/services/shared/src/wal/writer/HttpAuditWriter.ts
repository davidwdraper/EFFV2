// backend/services/shared/src/wal/writer/HttpAuditWriter.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0027 — SvcClient/SvcReceiver S2S Contract (baseline, pre-auth)
 * - ADR-0029 — Contract-ID + BodyHandler pipeline (headers; route-picked schema)
 *
 * Purpose:
 * - HTTP-based audit writer that ships WAL batches to the Audit service via shared SvcClient.
 * - Pure I/O; no env reads, no schema logic drift. Idempotency handled upstream/downstream.
 *
 * Contract:
 * - Implements IAuditWriter.writeBatch(batch) → Promise<void>.
 * - Throws on failure; WAL retains entries for replay. Safe for duplicate sends.
 *
 * Invariants:
 * - Request body MUST satisfy AuditEntriesRequest exactly.
 * - Header "X-NV-Contract" MUST equal "audit/entries@v1".
 * - No back-compat branches. Legacy/invalid records → fail-fast with explicit diagnostics.
 */

import {
  AuditEntriesV1Contract,
  AuditEntriesRequest,
} from "../../contracts/audit/audit.entries.v1.contract";
import type { IAuditWriter } from "./IAuditWriter";
import type { SvcCallOptions, SvcResponse } from "../../svc/types";

// NOTE: We accept the batch as produced by WAL producers (gateway middleware).
// It must already be in the canonical shape { meta, blob:{ phase:'begin'|'end', ... } }.
// We do a pre-flight Zod validation before sending.
type SvcClientLike = {
  call<T = unknown>(opts: SvcCallOptions): Promise<SvcResponse<T>>;
};

export interface HttpAuditWriterOptions {
  svcClient: SvcClientLike;
  auditSlug: string; // e.g., "audit"
  auditVersion: number; // e.g., 1
  route?: string; // service-local path (default "/entries")
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
    this.route = opts.route ?? "/entries"; // service-local; resolver composes /api/<slug>/v<ver>
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.retries = Math.max(0, opts.retries ?? 3);
    this.backoffMs = Math.max(0, opts.backoffMs ?? 250);
  }

  public async writeBatch(batch: ReadonlyArray<unknown>): Promise<void> {
    // Defensive copy; we never mutate caller buffers.
    const entries = Array.isArray(batch) ? batch.slice() : [];
    if (entries.length === 0) return;

    // 1) Pre-flight validation against the shared contract (no drift).
    const body = { entries } as unknown;
    const parsed = AuditEntriesRequest.safeParse(body);
    if (!parsed.success) {
      // Produce a precise, operator-friendly error (no back-compat).
      const issues = JSON.stringify(parsed.error.issues, null, 2);
      throw new Error(
        `HttpAuditWriter: payload_shape_invalid — AuditEntriesRequest.parse failed with issues:\n${issues}`
      );
    }

    const contractId = AuditEntriesV1Contract.getContractId(); // "audit/entries@v1"

    // 2) Send with retries for transient upstream/network faults.
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.retries) {
      try {
        await this.svcClient.call({
          slug: this.slug,
          version: this.ver,
          path: this.route,
          method: "POST",
          body: parsed.data, // already validated
          timeoutMs: this.timeoutMs,
          headers: {
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

    if (lastError) throw lastError;
  }

  // Retry only on genuine transient scenarios. Contract rejections are NOT retryable.
  private isRetryable(err: any): boolean {
    const status = err?.status ?? err?.response?.status;
    if (typeof status === "number") {
      if (status >= 500) return true; // upstream/server faults
      return false; // 4xx are permanent contract/policy errors
    }
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
    if (typeof status === "number") parts.push(`status=${status}`);
    const code = err?.code ?? err?.cause?.code;
    if (code) parts.push(`code=${code}`);
    return parts.join(" ");
  }

  private async sleep(ms: number): Promise<void> {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }
}
