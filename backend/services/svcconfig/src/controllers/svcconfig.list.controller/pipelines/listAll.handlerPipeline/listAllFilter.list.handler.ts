// backend/services/svcconfig/src/controllers/svcconfig.list.controller/handlers/listAllFilter.list.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0030 (SvcConfig architecture — env/slug scoped routing)
 *   - ADR-0017 (Problem+JSON error semantics; Ops-guided detail)
 *   - LDD-19 (S2S protocol; x-service-name caller identity)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
 *
 * Purpose:
 * - Build deterministic filter for svcconfig listAll.
 * - Enforce:
 *     • Always: env + isEnabled:true
 *     • For non-gateway callers: isS2STarget:true
 *     • Only if caller is gateway: isGatewayTarget:true (public edge routes)
 * - listAll remains fully server-controlled, no client filters applied.
 *
 * Invariants:
 * - Reads runtime vars via HandlerBase.getVar() (SvcRuntime-backed).
 * - Must not throw out of execute(); all errors are attached via failWithError().
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

const ORIGIN_FILE =
  "backend/services/svcconfig/src/controllers/svcconfig.list.controller/handlers/listAllFilter.list.handler.ts";

export class ListAllFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerJsonBase) {
    super(ctx, controller);
  }

  public handlerName(): string {
    return "code.svcconfig.listAll.filter";
  }

  protected handlerPurpose(): string {
    return "Build a deterministic server-controlled list.filter for svcconfig listAll (env + enabled + caller-scoped targeting).";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    try {
      const env = this.getVar("NV_ENV", true);
      const version = this.getVar("NV_SVCCONFIG_VERSION"); // optional

      // Determine caller (x-service-name propagated via SvcClient)
      const callerServiceName =
        (this.safeCtxGet<string>("caller.serviceName") as string | undefined) ||
        undefined;
      const isGatewayCaller = callerServiceName === "gateway";

      // Base filter: env + enabled
      const filter: Record<string, unknown> = {
        env,
        isEnabled: true,
      };

      // For non-gateway callers we care about S2S targets (worker-to-worker rails)
      if (!isGatewayCaller) {
        filter.isS2STarget = true;
      }

      // For gateway, restrict to public gateway targets
      if (isGatewayCaller) {
        filter.isGatewayTarget = true;
      }

      if (version) {
        // Version is optional and env-controlled; only apply if present
        filter.version = version;
      }

      // Defensive merging with prior filters
      const existing =
        (this.safeCtxGet<Record<string, unknown>>("list.filter") as
          | Record<string, unknown>
          | undefined) ?? {};
      const merged = { ...existing, ...filter };

      this.ctx.set("list.filter", merged);

      // listAll → non-paged HTTP semantics; ensure large enough internal limit
      const q =
        (this.safeCtxGet<Record<string, unknown>>("query") as
          | Record<string, unknown>
          | undefined) ?? {};
      if (q.limit === undefined) {
        // bounded; DbReadListHandler enforces MAX_LIMIT safely
        q.limit = 1000;
        this.ctx.set("query", q);
      }

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "list_all_filter_applied",
          handler: this.handlerName(),
          filterKeys: Object.keys(merged),
          env,
          hasVersion: !!version,
          callerServiceName,
          isGatewayCaller,
          requestId,
        },
        "svcconfig listAll filter applied"
      );
    } catch (rawError: any) {
      const msg =
        rawError instanceof Error ? rawError.message : String(rawError ?? "");
      const err = this.failWithError({
        httpStatus: 500,
        title: "list_all_filter_failed",
        detail:
          msg ||
          "Failed to build svcconfig listAll filter. Ops: inspect logs for requestId and svcconfig listAll handler.",
        stage: "svcconfig.listAll.filter.execute",
        requestId,
        origin: { file: ORIGIN_FILE, method: "execute" },
        rawError,
        logMessage:
          "ListAllFilterHandler.execute failed while building listAll filter",
        logLevel: "error",
      });

      // Ensure finalize-visible error surface (even if callers ignore ctx['error']).
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", err.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: err.title,
        status: err.httpStatus,
        code: "LIST_ALL_FILTER_FAILED",
        detail: err.detail,
        requestId,
      });

      return;
    }
  }
}
