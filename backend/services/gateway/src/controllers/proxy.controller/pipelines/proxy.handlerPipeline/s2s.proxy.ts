// backend/services/gateway/src/controllers/proxy.controller/pipelines/proxy.handlerPipeline/s2s.proxy.ts
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
 *   - Reads proxy.* context seeded by the controller and prior handlers.
 *   - Calls SvcClient.callRaw().
 *   - Copies status/body into ctx["response.*"] for ControllerBase.finalize().
 *
 * Invariants:
 * - Does not mutate or inspect DTOs.
 * - Does not attempt to "fix" worker responses.
 * - Leaves response shape exactly as the worker produced it (best-effort JSON parse).
 * - No env fallbacks (env must be seeded by controller from AppBase/SSB).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { GatewayProxyController } from "../../proxy.controller";

type HttpMethod = "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
type ForwardHeaders = Record<string, string>;

export class S2sProxyHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: GatewayProxyController) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Use SvcClient.callRaw() to proxy a single S2S call based on proxy.* context and mirror the worker status/body onto ctx['response.*'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "gateway_s2s_proxy_start", requestId },
      "gateway.proxy.s2s: enter"
    );

    try {
      const slug = this.ctx.get<string | undefined>("proxy.slug");
      const versionRaw = this.ctx.get<string | undefined>("proxy.version.raw");
      const method = this.ctx.get<HttpMethod | undefined>("proxy.method");
      const fullPath = this.ctx.get<string | undefined>("proxy.fullPath");
      const env = this.ctx.get<string | undefined>("proxy.env");
      const body = this.ctx.get<unknown>("proxy.body");
      const forwardHeaders = this.ctx.get<ForwardHeaders | undefined>(
        "proxy.forwardHeaders"
      );

      if (!slug) {
        this.failWithError({
          httpStatus: 500,
          title: "gateway_proxy_missing_slug",
          detail:
            "Gateway proxy expected targetSlug in path params but none was provided. Dev: ensure the route pattern is `/api/:slug/v:version/*`.",
          stage: "proxy.s2s.slug.missing",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: ctx['proxy.slug'] missing; route pattern likely misconfigured.",
          logLevel: "error",
        });
        return;
      }

      if (!versionRaw) {
        this.failWithError({
          httpStatus: 500,
          title: "gateway_proxy_missing_version",
          detail:
            "Gateway proxy expected targetVersion in path params but none was provided. Dev: ensure the route pattern is `/api/:slug/v:version/*`.",
          stage: "proxy.s2s.version.missing",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: ctx['proxy.version.raw'] missing; route pattern likely misconfigured.",
          logLevel: "error",
        });
        return;
      }

      if (!method) {
        this.failWithError({
          httpStatus: 500,
          title: "gateway_proxy_missing_method",
          detail:
            "Gateway proxy expected an HTTP method on proxy.context but none was provided. Dev: ensure the controller seeds `proxy.method` from req.method.",
          stage: "proxy.s2s.method.missing",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: ctx['proxy.method'] missing; controller did not seed HTTP method.",
          logLevel: "error",
        });
        return;
      }

      if (!fullPath) {
        this.failWithError({
          httpStatus: 500,
          title: "gateway_proxy_missing_full_path",
          detail:
            "Gateway proxy expected the full inbound path (including `/api`) on proxy.context but none was provided. Dev: ensure the controller seeds `proxy.fullPath` from req.originalUrl.",
          stage: "proxy.s2s.fullPath.missing",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: ctx['proxy.fullPath'] missing; controller did not seed originalUrl.",
          logLevel: "error",
        });
        return;
      }

      if (!env || !env.trim()) {
        this.failWithError({
          httpStatus: 500,
          title: "gateway_proxy_missing_env",
          detail:
            "Gateway proxy expected env label on proxy.context but none was provided. Dev: ensure controller seeds `proxy.env` from AppBase.getEnvLabel() (SvcRuntime authoritative).",
          stage: "proxy.s2s.env.missing",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: ctx['proxy.env'] missing; controller did not seed env label.",
          logLevel: "error",
        });
        return;
      }

      const version = Number.parseInt(versionRaw, 10);
      if (!Number.isFinite(version)) {
        this.failWithError({
          httpStatus: 500,
          title: "gateway_proxy_version_parse_failed",
          detail:
            "Gateway failed to parse targetVersion in proxy route. Dev: ensure the route pattern is `/api/:slug/v:version/*` and version is numeric.",
          stage: "proxy.s2s.version.parse_failed",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: failed to parse numeric version from proxy.version.raw.",
          logLevel: "error",
        });
        return;
      }

      const controller = this.controller as unknown as GatewayProxyController;

      let svcClient: ReturnType<typeof controller.getSvcClient>;
      try {
        svcClient = controller.getSvcClient();
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "gateway_proxy_svcclient_unavailable",
          detail:
            "Gateway proxy could not obtain a SvcClient instance for S2S calls. Ops: verify GatewayProxyController wiring.",
          stage: "proxy.s2s.svcClient.missing",
          requestId,
          rawError: err,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: controller.getSvcClient() threw or is unavailable.",
          logLevel: "error",
        });
        return;
      }

      try {
        const result = await svcClient.callRaw({
          env,
          slug,
          version,
          method,
          fullPath,
          body,
          requestId,
          extraHeaders: forwardHeaders,
        });

        let parsedBody: unknown = result.bodyText;
        if (result.bodyText) {
          try {
            parsedBody = JSON.parse(result.bodyText);
          } catch {
            // leave as raw string
          }
        }

        this.ctx.set("handlerStatus", "ok");
        this.ctx.set("response.status", result.status);
        this.ctx.set("response.body", parsedBody);

        this.log.debug(
          {
            event: "gateway_s2s_proxy_ok",
            requestId,
            status: result.status,
            slug,
            version,
            env,
          },
          "gateway.proxy.s2s: S2S proxy call completed"
        );
      } catch (err) {
        this.failWithError({
          httpStatus: 502,
          title: "gateway_proxy_s2s_failed",
          detail:
            "Gateway failed to complete a service-to-service proxy call. Ops: check svcconfig target for the requested slug/version, and verify network connectivity and auth configuration.",
          stage: "proxy.s2s.call_failed",
          requestId,
          rawError: err,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "gateway.proxy.s2s: SvcClient.callRaw() threw while proxying S2S request.",
          logLevel: "error",
        });

        this.log.error(
          {
            event: "gateway_s2s_proxy_error",
            requestId,
            error: (err as Error)?.message,
            targetSlug: slug,
            targetVersion: version,
            env,
          },
          "gateway.proxy.s2s: S2S proxy call failed"
        );
        return;
      }
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "gateway_proxy_s2s_handler_failure",
        detail:
          "Unhandled exception while executing gateway S2S proxy handler. Ops: inspect logs for requestId and stack frame.",
        stage: "proxy.s2s.execute.unhandled",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "gateway.proxy.s2s: unhandled exception in handler execute().",
        logLevel: "error",
      });
    } finally {
      this.log.debug(
        { event: "gateway_s2s_proxy_end", requestId },
        "gateway.proxy.s2s: exit"
      );
    }
  }
}
