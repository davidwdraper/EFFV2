// backend/services/gateway/src/controllers/proxy.controller/pipelines/proxy.handlerPipeline/gatewayProxyS2s.handler.ts
/**
 * Docs:
 * - SOP: DTO-first for workers; raw pass-through at gateway edge (ADR-0066).
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Single-responsibility handler that:
 *   - Reads proxy.* context seeded by the controller.
 *   - Calls SvcClient.callRaw().
 *   - Copies status/body into ctx["response.*"] for ControllerBase.finalize().
 *
 * Invariants:
 * - Does not mutate or inspect DTOs.
 * - Does not attempt to "fix" worker responses.
 * - Leaves response shape exactly as the worker produced it (best-effort JSON parse).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { GatewayProxyController } from "../../proxy.controller";

type HttpMethod = "GET" | "PUT" | "PATCH" | "POST" | "DELETE";

export class GatewayProxyS2sHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: GatewayProxyController) {
    super(ctx, controller);
  }

  protected override async execute(): Promise<void> {
    const requestId = this.ctx.get<string>("requestId");

    const slug = this.ctx.get<string | undefined>("proxy.slug");
    const versionRaw = this.ctx.get<string | undefined>("proxy.version.raw");
    const method = this.ctx.get<HttpMethod | undefined>("proxy.method");
    const pathSuffix = this.ctx.get<string | undefined>("proxy.pathSuffix");
    const envRaw = this.ctx.get<string | undefined>("proxy.env");
    const body = this.ctx.get<unknown>("proxy.body");

    if (!slug) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "gateway_proxy_missing_slug",
        detail:
          "Gateway proxy expected targetSlug in path params but none was provided. Dev: ensure the route pattern is `/api/:slug/v:version/*`.",
        status: 500,
        code: "GATEWAY_PROXY_MISSING_SLUG",
        requestId,
      });
      return;
    }

    if (!versionRaw) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "gateway_proxy_missing_version",
        detail:
          "Gateway proxy expected targetVersion in path params but none was provided. Dev: ensure the route pattern is `/api/:slug/v:version/*`.",
        status: 500,
        code: "GATEWAY_PROXY_MISSING_VERSION",
        requestId,
      });
      return;
    }

    if (!method) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "gateway_proxy_missing_method",
        detail:
          "Gateway proxy expected an HTTP method on proxy.context but none was provided. Dev: ensure the controller seeds `proxy.method` from req.method.",
        status: 500,
        code: "GATEWAY_PROXY_MISSING_METHOD",
        requestId,
      });
      return;
    }

    const version = Number.parseInt(versionRaw, 10);
    if (!Number.isFinite(version)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "gateway_proxy_version_parse_failed",
        detail:
          "Gateway failed to parse targetVersion in proxy route. Dev: ensure the route pattern is `/api/:slug/v:version/*` and version is numeric.",
        status: 500,
        code: "GATEWAY_PROXY_VERSION_PARSE_FAILED",
        requestId,
        rawValue: versionRaw,
      });
      return;
    }

    if (!pathSuffix) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "gateway_proxy_missing_path_suffix",
        detail:
          "Gateway proxy expected a path suffix after `/api/:slug/v:version/`. Dev: ensure the inbound path includes an operation segment (e.g., `login`, `user/create`).",
        status: 500,
        code: "GATEWAY_PROXY_MISSING_PATH_SUFFIX",
        requestId,
      });
      return;
    }

    const env = envRaw ?? "unknown";

    const controller = this.controller as unknown as GatewayProxyController;
    const svcClient = controller.getSvcClient();

    try {
      const result = await svcClient.callRaw({
        env,
        slug,
        version,
        method,
        pathSuffix,
        body,
        requestId,
      });

      // Best-effort JSON parse; if it fails, return raw text.
      let parsedBody: unknown = result.bodyText;
      if (result.bodyText) {
        try {
          parsedBody = JSON.parse(result.bodyText);
        } catch {
          // leave as raw string
        }
      }

      this.ctx.set("handlerStatus", "success");
      this.ctx.set("response.status", result.status);
      this.ctx.set("response.body", parsedBody);
    } catch (err) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 502);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "gateway_proxy_s2s_failed",
        detail:
          "Gateway failed to complete a service-to-service proxy call. Ops: check svcconfig target for the requested slug/version, and verify network connectivity and auth configuration.",
        status: 502,
        code: "GATEWAY_PROXY_S2S_FAILED",
        requestId,
        error: (err as Error)?.message,
        targetSlug: slug,
        targetVersion: version,
        env,
      });
    }
  }
}
