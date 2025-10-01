// backend/shared/src/svc/SvcReceiver.ts
/**
 * Purpose:
 * - Normalize S2S request handling and JSON envelope responses.
 * - Framework-agnostic: works with any Express-like req/res.
 */

import { randomUUID } from "crypto";
import type { HttpLikeRequest, HttpLikeResponse } from "./types";

export class SvcReceiver {
  constructor(private readonly serviceName: string) {}

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

    try {
      const result = await handler({
        requestId,
        method,
        path: req.url,
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
      res.status(status).json({
        ok: true,
        service: this.serviceName,
        requestId,
        data: result.body ?? null,
      });
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      res.setHeader("x-request-id", requestId);
      res.status(500).json({
        ok: false,
        service: this.serviceName,
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
