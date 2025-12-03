// backend/services/gateway/src/controllers/proxy.controller/pipelines/proxy.handlerPipeline/normalizeProxyHeaders.handler.ts
/**
 * Docs:
 * - SOP: Gateway edge owns header sanitation; SvcClient stays generic.
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Normalize inbound HTTP headers into a string->string map that is safe to
 *   forward to worker services via SvcClient.callRaw().
 *
 * Invariants:
 * - Gateway owns which headers are NOT forwarded (hop-by-hop, client auth).
 * - Does NOT inspect or special-case business headers (e.g. x-nv-password).
 * - Leaves all other headers intact; we don't know what workers will need.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { GatewayProxyController } from "../../proxy.controller";

type InboundHeaders = Record<string, unknown>;
type ForwardHeaders = Record<string, string>;

export class NormalizeProxyHeadersHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: GatewayProxyController) {
    super(ctx, controller);
  }

  protected override async execute(): Promise<void> {
    const requestId = this.ctx.get<string>("requestId");
    const inbound = this.ctx.get<InboundHeaders | undefined>("proxy.headers");

    if (!inbound) {
      // Nothing to normalize; leave ctx["proxy.forwardHeaders"] undefined.
      this.log.debug(
        { requestId },
        "normalizeProxyHeaders: no inbound headers on proxy.context"
      );
      return;
    }

    const forward = this.buildForwardHeaders(inbound);

    this.ctx.set("proxy.forwardHeaders", forward);

    this.log.debug(
      {
        requestId,
        forwardedKeys: Object.keys(forward),
      },
      "normalizeProxyHeaders: prepared forwardable headers for S2S call"
    );
  }

  /**
   * Normalize inbound headers (Node/Express form) into a string->string map,
   * removing headers that must never be forwarded by the gateway.
   *
   * Rules:
   * - Keep everything by default (we don't know what workers need).
   * - Drop hop-by-hop / edge-only headers:
   *   • host / connection / content-length / transfer-encoding
   *   • authorization (client auth must NOT be forwarded downstream)
   * - Do NOT drop business headers (x-nv-*, etc.).
   */
  private buildForwardHeaders(inbound: InboundHeaders): ForwardHeaders {
    const reserved = new Set<string>([
      "host",
      "connection",
      "content-length",
      "transfer-encoding",
      "upgrade",
      "proxy-connection",
      // Client auth: gateway will eventually mint its own S2S token;
      // we never forward the client's Authorization header.
      "authorization",
    ]);

    const out: ForwardHeaders = {};

    for (const [key, value] of Object.entries(inbound)) {
      if (!key) continue;
      const lowerKey = key.toLowerCase();

      if (reserved.has(lowerKey)) continue;
      if (value == null) continue;

      if (Array.isArray(value)) {
        const joined = value
          .filter((v) => v != null)
          .map((v) => String(v))
          .join(", ");
        if (joined) out[lowerKey] = joined;
      } else {
        out[lowerKey] = String(value);
      }
    }

    return out;
  }
}
