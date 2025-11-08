// backend/shared/src/svc/SvcReceiver.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 — Base Hierarchy: ServiceEntrypoint vs ServiceBase
 *   - ADR-0015 — Structured Logger with bind() Context
 *   - ADR-0006 — Edge Logging (ingress-only)
 *   - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *   - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Normalize S2S request handling and canonical JSON envelope responses.
 * - Framework-agnostic: works with any Express-like req/res.
 *
 * Invariants:
 * - SUCCESS → RouterBase envelope:
 *      { ok: true, service, data: { status, body } }
 * - ERROR   → RFC7807 JSON (NOT enveloped)
 * - `x-request-id` is always echoed as a response header (not in body).
 *
 * Edge policy (strict):
 * - Ingress-only, and respects LOG_EDGE=0|1 (or legacy LOG_EDGE_ENABLED).
 */

import { randomUUID } from "crypto";
import type { HttpLikeRequest, HttpLikeResponse } from "./types";
import { ServiceBase } from "../base/ServiceBase";
import { EnvelopeContract } from "../contracts/envelope.contract";

export class SvcReceiver extends ServiceBase {
  constructor(serviceName: string) {
    super({ service: serviceName, context: { component: "SvcReceiver" } });
  }

  public async receive(
    req: HttpLikeRequest,
    res: HttpLikeResponse,
    handler: (ctx: {
      requestId: string;
      method: string;
      path?: string;
      headers: Record<string, string>;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
    }) => Promise<{
      status?: number;
      body?: unknown;
      headers?: Record<string, string>;
    }>
  ): Promise<void> {
    const requestId = this.pickRequestId(req.headers);
    const method = String(req.method || "GET").toUpperCase();
    const headers = this.lowercaseHeaders(req.headers);
    const path = req.url;

    const log = this.bindLog({
      method,
      url: path,
      requestId,
      component: "SvcReceiver.receive",
    });

    // EDGE: ingress only — obeys LOG_EDGE master switch via BoundLogger.edge()
    log.edge({ phase: "ingress" }, "svc_edge");

    try {
      const result = await handler({
        requestId,
        method,
        path,
        headers,
        params: (req as any).params,
        query: (req as any).query,
        body: (req as any).body,
      });

      // Always echo request id + any controller headers
      res.setHeader("x-request-id", requestId);
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          if (v == null) continue;
          res.setHeader(k, v);
        }
      }

      const status = result.status ?? 200;

      // Completion logs (level-gated by Logger.ts)
      if (status >= 500) {
        log.error({ status }, "svc receive completed (error)");
      } else if (status >= 400) {
        log.warn({ status }, "svc receive completed (warn)");
      } else {
        log.info({ status }, "svc receive completed");
      }

      if (status >= 400) {
        // RFC7807 (no envelope for errors)
        const detail =
          (typeof (result.body as any)?.message === "string" &&
            (result.body as any).message) ||
          "request_failed";
        const title = status >= 500 ? "Internal Server Error" : "Bad Request";

        res.status(status).json({
          type: "about:blank",
          title,
          status,
          detail,
        });
        return;
      }

      // Success path — canonical RouterBase envelope
      const body = result.body ?? null;
      const envelope = EnvelopeContract.makeOk(this.service, status, body);
      res.status(status).json(envelope);
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);

      // Error completion log
      log.error({ err: message }, "svc receive exception");

      res.setHeader("x-request-id", requestId);
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: message,
      });
    }
  }

  private pickRequestId(h: Record<string, unknown>): string {
    const lower = this.lowercaseHeaders(h);
    return (
      lower["x-request-id"] ||
      lower["x-correlation-id"] ||
      lower["request-id"] ||
      randomUUID()
    );
  }

  private lowercaseHeaders(h: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h || {})) {
      if (v == null) continue;
      out[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
    }
    return out;
  }
}
