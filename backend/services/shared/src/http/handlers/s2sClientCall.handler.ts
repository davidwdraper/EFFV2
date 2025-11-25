// backend/services/shared/src/http/handlers/s2sClientCall.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; S2S calls via SvcClient (no raw URLs)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; DTO as wire authority)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0044 (EnvServiceDto as DTO — key/value env contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0052 (S2S via ServiceClient) — future alignment
 *   - ADR-0056 (Typed routes use :dtoType on all CRUD operations)
 *
 * Purpose:
 * - Generic S2S call handler for pipelines that need to hop to another service.
 * - For this phase, acts as a stub that clearly returns 501 until SvcClient v3 exists.
 *
 * Inputs (ctx):
 * - "s2s.slug":    string   (target service slug, e.g., "user")
 * - "s2s.version": string   (target API version, e.g., "v1")
 * - "dtoType":     string   (current route dtoType, e.g., "auth")
 * - "requestId":   string
 * - "svcEnv":      EnvServiceDto (from ControllerBase.makeContext, per ADR-0044)
 *
 * Stub Outputs (current behavior):
 * - "handlerStatus": "error"
 * - "response.status": 501
 * - "response.body": ProblemDetails-like NOT_IMPLEMENTED payload
 *
 * Future behavior (non-stub):
 * - Build an outbound wire bag envelope from ctx (e.g., ctx["authDto"] → items[]).
 * - Use SvcClient v3 to:
 *     - Resolve target URL via svcconfig (env + slug + version)
 *     - Attach S2S headers (authorization, x-request-id, x-service-name, x-api-version)
 *     - Call the appropriate route on the target service.
 * - On success: place the returned DtoBag onto ctx["bag"] so ControllerBase.finalize()
 *   can build the wire response.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";

export class S2sClientCallHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug(
      { event: "execute_enter" },
      "s2sClientCall: enter handler (stub)"
    );

    const requestId = this.ctx.get("requestId");
    const slug = this.ctx.get<string>("s2s.slug");
    const version = this.ctx.get<string>("s2s.version");
    const dtoType = this.ctx.get<string>("dtoType");

    // EnvServiceDto is already placed on ctx by ControllerBase.makeContext().
    const svcEnv = this.ctx.get<any>("svcEnv");
    let envLabel: string | undefined = this.ctx.get<string>("s2s.env");

    // Prefer explicit s2s.env if someone set it earlier; otherwise derive from svcEnv.
    if (!envLabel && svcEnv && typeof svcEnv.getEnvVar === "function") {
      try {
        // Convention: NV_ENV carries the environment label (e.g., "dev", "staging", "prod").
        envLabel = svcEnv.getEnvVar("NV_ENV");
      } catch (err) {
        this.log.debug(
          {
            event: "svcenv_envvar_missing",
            error: (err as Error)?.message,
          },
          "s2sClientCall: svcEnv.getEnvVar('NV_ENV') failed (non-fatal for stub)"
        );
      }
    }

    if (!slug || !version) {
      // Misconfiguration / programmer error — fail loudly so this gets fixed.
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "S2S_CONFIG_MISSING",
        title: "Internal Error",
        detail:
          "s2sClientCall handler requires s2s.slug and s2s.version on the context. Dev: ensure pipeline seeds these keys before this handler.",
        requestId,
      });

      this.log.error(
        {
          event: "s2s_config_missing",
          slugPresent: !!slug,
          versionPresent: !!version,
          handler: this.constructor.name,
        },
        "s2sClientCall: missing s2s.slug or s2s.version on ctx"
      );

      this.log.debug(
        { event: "execute_exit", reason: "config_missing" },
        "s2sClientCall: exit handler (stub)"
      );
      return;
    }

    // NOTE (Stub behavior):
    // - SvcClient v3 and S2S JWT plumbing are not yet implemented in this refactor.
    // - Rather than fake success, we expose a clear 501 so tests and callers know
    //   the S2S hop is wired but not live.
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("response.status", 501);
    this.ctx.set("response.body", {
      code: "S2S_CLIENT_CALL_NOT_IMPLEMENTED",
      title: "Not Implemented",
      detail:
        "S2S client call is wired but ServiceClient/SvcClient v3 is not implemented yet. Ops: this endpoint is expected to return 501 until S2S is completed.",
      requestId,
      slug,
      version,
      dtoType,
      env: envLabel,
      hint: "Dev: implement SvcClient v3 using svcconfig + env-service, then have this handler build an outbound wire bag and place the returned DtoBag on ctx['bag'].",
    });

    this.log.warn(
      {
        event: "s2s_stub",
        slug,
        version,
        dtoType,
        env: envLabel,
        requestId,
      },
      "s2sClientCall: SvcClient-backed S2S call not implemented yet"
    );

    this.log.debug(
      { event: "execute_exit" },
      "s2sClientCall: exit handler (stub)"
    );
  }
}
