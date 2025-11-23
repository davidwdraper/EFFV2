// backend/services/svcconfig/src/controllers/svcconfig.list.controller/handlers/mirrorFilter.list.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0030 (SvcConfig architecture — env/slug scoped routing)
 *
 * Purpose:
 * - Build a deterministic filter for the "mirror" view of svcconfig.
 * - Avoids any client-provided query params; mirror is fully server-controlled.
 *
 * Inputs:
 * - Env vars via HandlerBase.getVar() (backed by EnvServiceDto):
 *   - NV_ENV               → current environment (e.g., "dev", "staging", "prod")
 *   - NV_SVCCONFIG_VERSION → (optional) config version for this environment
 *
 * Outputs (ctx):
 * - "list.filter": Record<string, unknown>
 *   - At minimum scoped by { env }.
 *   - Optionally adds { version } if provided.
 * - "query.limit" may be increased to ensure the mirror sees a full snapshot.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

export class MirrorFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const env = this.getVar("NV_ENV");
    const version = this.getVar("NV_SVCCONFIG_VERSION");

    if (!env) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "ENV_MISSING_FOR_MIRROR",
        title: "Internal Error",
        detail:
          "NV_ENV is not defined for svcconfig mirror. Ops: ensure env-service has published NV_ENV for this service.",
      });

      this.log.error(
        {
          event: "env_missing_for_mirror",
          hasEnv: !!env,
        },
        "svcconfig mirror aborted — NV_ENV missing"
      );

      return;
    }

    const filter: Record<string, unknown> = { env };

    if (version) {
      filter.version = version;
    }

    // Merge with any pre-existing filter (defensive hook for future enhancements)
    const existing =
      (this.ctx.get("list.filter") as Record<string, unknown>) ?? {};
    const merged = { ...existing, ...filter };

    this.ctx.set("list.filter", merged);

    // Mirror should typically pull a full snapshot; if no explicit limit, bump it.
    const q = (this.ctx.get("query") as Record<string, unknown>) ?? {};
    if (q.limit === undefined) {
      // High but bounded; DbReadListHandler enforces MAX_LIMIT.
      q.limit = 1000;
      this.ctx.set("query", q);
    }

    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "mirror_filter_applied",
        filterKeys: Object.keys(merged),
        env,
        hasVersion: !!version,
      },
      "svcconfig mirror filter applied"
    );
  }
}
