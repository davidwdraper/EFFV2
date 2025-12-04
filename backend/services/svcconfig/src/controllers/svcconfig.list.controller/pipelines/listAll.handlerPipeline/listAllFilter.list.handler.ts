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
 *
 * Purpose:
 * - Build deterministic filter for svcconfig listAll.
 * - Enforce:
 *     • Always: env + isEnabled:true
 *     • For non-gateway callers: isS2STarget:true
 *     • Only if caller is gateway: isGatewayTarget:true (public edge routes)
 * - listAll remains fully server-controlled, no client filters applied.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

export class ListAllFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerJsonBase) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const env = this.getVar("NV_ENV");
    const version = this.getVar("NV_SVCCONFIG_VERSION");

    if (!env) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "Internal Error",
        status: 500,
        code: "ENV_MISSING_FOR_LIST_ALL",
        detail:
          "NV_ENV is not defined for svcconfig listAll. Ops: ensure env-service has published NV_ENV for this service.",
        requestId: this.ctx.get("requestId"),
      });

      this.log.error(
        {
          event: "env_missing_for_list_all",
          hasEnv: !!env,
        },
        "svcconfig listAll aborted — NV_ENV missing"
      );

      return;
    }

    // Determine caller (x-service-name propagated via SvcClient)
    const callerServiceName =
      (this.ctx.get("caller.serviceName") as string | undefined) || undefined;
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
      (this.ctx.get("list.filter") as Record<string, unknown>) ?? {};
    const merged = { ...existing, ...filter };

    this.ctx.set("list.filter", merged);

    // listAll → non-paged HTTP semantics; ensure large enough internal limit
    const q = (this.ctx.get("query") as Record<string, unknown>) ?? {};
    if (q.limit === undefined) {
      // bounded; DbReadListHandler enforces MAX_LIMIT safely
      q.limit = 1000;
      this.ctx.set("query", q);
    }

    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "list_all_filter_applied",
        filterKeys: Object.keys(merged),
        env,
        hasVersion: !!version,
        callerServiceName,
        isGatewayCaller,
      },
      "svcconfig listAll filter applied"
    );
  }
}
