// backend/services/gateway/src/proxy/GatewayProxyClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *   - ADR-#### (Gateway Proxy Client Fast Path)
 *
 * Purpose:
 * - Gateway-only fast proxy client.
 * - Resolves target baseUrl via svcconfig (through injected resolver path),
 *   forwards the request with identical /api/... path, returns raw response.
 *
 * Invariants:
 * - No DTO registry. No DTO hydration. No pipelines.
 * - Outbound path MUST equal inbound fullPath (only host/port differs).
 * - Never log header values.
 */

import type {
  RawResponse,
  SvcClientRawCallParams,
} from "@nv/shared/s2s/SvcClient.types";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

export type GatewayProxyRequest = {
  env: string;
  slug: string;
  version: number;
  method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  fullPath: string;
  requestId: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function stripHopByHopHeaders(
  inbound: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inbound)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    out[key] = v;
  }

  // Prevent caller from overriding gateway-owned canonical S2S headers.
  delete out["x-request-id"];
  delete out["x-service-name"];
  delete out["x-api-version"];

  return out;
}

export class GatewayProxyClient {
  private readonly svcClient: SvcClient;

  constructor(opts: { svcClient: SvcClient }) {
    this.svcClient = opts.svcClient;
  }

  public async proxy(req: GatewayProxyRequest): Promise<RawResponse> {
    const extraHeaders = stripHopByHopHeaders(req.headers);

    // IMPORTANT: SvcClient.callRaw expects { env, slug, version, method, fullPath, extraHeaders, body, requestId }
    const params: SvcClientRawCallParams = {
      env: req.env,
      slug: req.slug,
      version: req.version,
      method: req.method,
      fullPath: req.fullPath,
      requestId: req.requestId,
      extraHeaders,
      body: req.body,
      timeoutMs: req.timeoutMs,
    };

    return this.svcClient.callRaw(params);
  }
}
