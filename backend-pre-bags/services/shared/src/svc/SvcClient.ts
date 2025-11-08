// backend/services/shared/src/svc/SvcClient.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 * - ADR-0029 — Contract-ID + BodyHandler pipeline
 * - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Thin facade over SvcClientBase. Adds helpers that validate & unwrap the
 *   canonical success envelope using shared schemas.
 *
 * Invariants:
 * - Requests are flat JSON (no envelope).
 * - Responses are RouterBase envelopes on success, RFC7807 on error.
 * - Per-call headers (e.g., X-NV-Contract) are passed via opts.headers.
 */

import type { UrlResolver, SvcCallOptions, SvcResponse } from "./types";
import { SvcClientBase } from "./SvcClientBase";
import { z } from "zod";
import { Envelope, EnvelopeContract } from "../contracts/envelope.contract";

export class SvcClient extends SvcClientBase {
  constructor(
    resolveUrl: UrlResolver,
    defaults: { timeoutMs?: number; headers?: Record<string, string> } = {}
  ) {
    super(resolveUrl, defaults, { service: "shared" });
  }

  /** Raw call (transport only). Returns parsed JSON (envelope on 2xx). */
  public override async call<T = unknown>(
    opts: SvcCallOptions
  ): Promise<SvcResponse<T>> {
    return super.call<T>(opts);
  }

  /**
   * Call and **unwrap** the canonical success envelope using the supplied
   * shared **response** schema. Throws on non-2xx (RFC7807 expected).
   */
  public async callJson<TRes>(
    opts: SvcCallOptions,
    responseSchema: z.ZodType<TRes>
  ): Promise<{
    body: TRes;
    status: number;
    headers: Record<string, string>;
    requestId: string;
    envelope: Envelope<TRes>;
  }> {
    const res = await this.call<any>(opts); // T = raw envelope JSON
    // Validate & unwrap the envelope against the shared response schema
    const env = EnvelopeContract.parse<TRes>(res.data, responseSchema);
    return {
      body: env.data.body,
      status: env.data.status,
      headers: res.headers,
      requestId: res.requestId,
      envelope: env,
    };
  }
}
