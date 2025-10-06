// backend/shared/src/svc/SvcReceiver.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0006 (Edge Logging — first-class edge() channel)
 *
 * Purpose:
 * - Normalize S2S request handling and JSON envelope responses.
 * - Framework-agnostic: works with any Express-like req/res.
 *
 * Notes:
 * - Inherits logger/env from ServiceBase.
 * - Emits a single edge() line on entry, and info/warn/error on completion.
 */

import { randomUUID } from "crypto";
import type { HttpLikeRequest, HttpLikeResponse } from "./types";
import { ServiceBase } from "../base/ServiceBase";

export class SvcReceiver extends ServiceBase {
  constructor(serviceName: string) {
    super({ service: serviceName, context: { component: "SvcReceiver" } });
  }

  /**
   * Receive an HTTP-like request and respond with a uniform envelope.
   * `handler` should return { status?, body?, headers? }.
   */
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

    // Edge hit on ingress
    log.edge({ phase: "ingress" }, "svc receive");

    try {
      const result = await handler({
        requestId,
        method,
        path,
        headers,
        params: req.params,
        query: req.query,
        body: req.body,
      });

      // Apply headers first (including request id echo)
      res.setHeader("x-request-id", requestId);
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          res.setHeader(k, v);
        }
      }

      const status = result.status ?? 200;

      // Completion log (info for 2xx/3xx, warn for 4xx)
      if (status >= 400 && status < 500) {
        log.warn({ status }, "svc receive completed (warn)");
      } else {
        log.info({ status }, "svc receive completed");
      }

      res.status(status).json({
        ok: true,
        service: this.service,
        requestId,
        data: result.body ?? null,
      });
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);

      // Error completion log
      log.error({ err: message }, "svc receive exception");

      res.setHeader("x-request-id", requestId);
      res.status(500).json({
        ok: false,
        service: this.service,
        requestId,
        error: { code: "internal_error", message },
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
