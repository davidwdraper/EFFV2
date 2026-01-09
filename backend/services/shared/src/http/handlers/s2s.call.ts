// backend/services/shared/src/http/handlers/s2sClientCall.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; S2S calls via SvcClient (no raw URLs)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; DTO as wire authority)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0044 (DbEnvServiceDto as DTO — key/value env contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0052 (S2S via ServiceClient) — future alignment
 *   - ADR-0056 (Typed routes use :dtoType on all CRUD operations)
 *
 * Purpose:
 * - Generic S2S call handler for pipelines that need to hop to another service.
 *
 * Inputs (ctx):
 * - "s2s.slug":    string   (target service slug, e.g., "user")
 * - "s2s.version": string   (target API version, e.g., "v1")
 * - "dtoKey":     string   (current route dtoType, e.g., "auth")
 * - "requestId":   string
 * - "svcEnv":      DbEnvServiceDto (from ControllerBase.makeContext, per ADR-0044)
 *
 * Stub Outputs (current behavior):
 * - "handlerStatus": "error"
 * - ctx["status"]: 501
 * - ctx["error"]: NvHandlerError (mapped to ProblemDetails by finalize)
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

export class S2sCallHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Stub S2S hop that validates S2S config and returns a structured 501 until SvcClient v3 is implemented.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "s2sClientCall: enter handler (stub)"
    );

    try {
      const slug = this.safeCtxGet<string>("s2s.slug");
      const version = this.safeCtxGet<string>("s2s.version");
      const dtoType = this.safeCtxGet<string>("dtoKey");

      // DbEnvServiceDto is already placed on ctx by ControllerBase.makeContext().
      const svcEnv = this.safeCtxGet<any>("svcEnv");
      let envLabel = this.safeCtxGet<string>("s2s.env");

      // Prefer explicit s2s.env if someone set it earlier; otherwise derive from svcEnv.
      if (!envLabel && svcEnv && typeof svcEnv.getEnvVar === "function") {
        try {
          // Convention: NV_ENV carries the environment label (e.g., "dev", "staging", "prod").
          envLabel = svcEnv.getEnvVar("NV_ENV");
        } catch (err) {
          this.log.debug(
            {
              event: "svcenv_envvar_missing",
              error: err instanceof Error ? err.message : String(err),
              requestId,
            },
            "s2sClientCall: svcEnv.getEnvVar('NV_ENV') failed (non-fatal for stub)"
          );
        }
      }

      if (!slug || !version) {
        // Misconfiguration / programmer error — fail loudly so this gets fixed.
        this.failWithError({
          httpStatus: 500,
          title: "s2s_config_missing",
          detail:
            "s2sClientCall handler requires s2s.slug and s2s.version on the context. Dev: ensure pipeline seeds these keys before this handler.",
          stage: "config.s2s",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              slugPresent: !!slug,
              versionPresent: !!version,
            },
          ],
          logMessage:
            "s2sClientCall: missing s2s.slug or s2s.version on ctx for S2S hop.",
          logLevel: "error",
        });
        return;
      }

      // NOTE (Stub behavior):
      // - SvcClient v3 and S2S JWT plumbing are not yet implemented in this refactor.
      // - Rather than fake success, we expose a clear 501 so tests and callers know
      //   the S2S hop is wired but not live.
      this.failWithError({
        httpStatus: 501,
        title: "s2s_client_call_not_implemented",
        detail:
          "S2S client call is wired but ServiceClient/SvcClient v3 is not implemented yet. Ops: this endpoint is expected to return 501 until S2S is completed.",
        stage: "stub.notImplemented",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            slug,
            version,
            dtoType,
            env: envLabel,
          },
        ],
        logMessage:
          "s2sClientCall: SvcClient-backed S2S call not implemented yet (stub returning 501).",
        logLevel: "warn",
      });
    } catch (err) {
      // Catch-all for any unexpected handler bug.
      this.failWithError({
        httpStatus: 500,
        title: "s2s_client_call_unhandled",
        detail:
          "S2S client call handler threw an unhandled exception. Ops: search logs for this requestId and handler to locate the root cause.",
        stage: "execute.unhandled",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        rawError: err,
        logMessage:
          "s2sClientCall: unhandled exception during S2S stub execution.",
        logLevel: "error",
      });
    }
  }
}
