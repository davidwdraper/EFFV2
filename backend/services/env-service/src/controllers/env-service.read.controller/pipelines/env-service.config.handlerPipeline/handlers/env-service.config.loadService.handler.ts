// backend/services/env-service/src/controllers/env-service.read.controller/pipelines/env-service.config.handlerPipeline/handlers/env-service.config.loadService.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0048 (DbReader contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Second step of the /config pipeline:
 *     GET /api/env-service/v1/env-service/config?slug=&version=&env=
 *
 * Responsibilities:
 * - Reuse the DbReader<EnvServiceDto> created by EnvServiceConfigLoadRootHandler.
 * - Load the *service-level* config bag for the requested slug (original target).
 * - Seed the HandlerContext bus with:
 *     • envConfig.serviceBag (DtoBag<EnvServiceDto>, may be empty / undefined)
 *
 * Notes:
 * - Does NOT treat “not found” as an error; merge handler decides how to fall back.
 * - DB-level failures are fatal (500) with explicit Ops guidance.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { EnvConfigReader } from "../../../../../svc/EnvConfigReader";

export class EnvServiceConfigLoadServiceHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const requestId =
      (this.ctx.get<string>("requestId") as string) || "unknown";

    const env = this.ctx.get<string>("envConfig.env") as string | undefined;
    const version = this.ctx.get<number>("envConfig.version") as
      | number
      | undefined;
    const targetSlug = this.ctx.get<string>("envConfig.targetSlug") as
      | string
      | undefined;

    const dbReader = this.ctx.get<DbReader<EnvServiceDto>>(
      "envConfig.dbReader"
    ) as DbReader<EnvServiceDto> | undefined;

    if (!env || !version || !targetSlug || !dbReader) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_CONFIG_PIPELINE_MISWIRED",
        title: "Internal Error",
        detail:
          "Env-service config pipeline missing required context. Ops: ensure EnvServiceConfigLoadRootHandler runs and seeds envConfig.env/version/targetSlug/dbReader before EnvServiceConfigLoadServiceHandler.",
        requestId,
      });
      return;
    }

    this.log.debug(
      {
        event: "env_config_service_load_start",
        env,
        slug: targetSlug,
        version,
        requestId,
      },
      "loading service-level env-service config (slug=target service)"
    );

    try {
      // Mirror root handler, but use the original requested slug instead of 'service-root'.
      const serviceBag = await EnvConfigReader.getEnv(dbReader, {
        env,
        slug: targetSlug,
        version,
      });

      this.ctx.set("envConfig.serviceBag", serviceBag);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "env_config_service_load_ok",
          env,
          slug: targetSlug,
          version,
          serviceCount: serviceBag.count(),
          requestId,
        },
        "service-level env config loaded"
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isNotFound = msg.startsWith("ENV_CONFIG_NOT_FOUND");

      if (isNotFound) {
        // This is fine; merge step decides what to do with “no root and no service”.
        this.log.info(
          {
            event: "env_config_service_not_found",
            env,
            slug: targetSlug,
            version,
            requestId,
          },
          "no service-level env config found; pipeline will fall back to root-only config if present"
        );

        this.ctx.set("handlerStatus", "ok");
        return;
      }

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_CONFIG_SERVICE_READ_FAILED",
        title: "Internal Error",
        detail: msg,
        requestId,
      });

      this.log.error(
        {
          event: "env_config_service_load_error",
          env,
          slug: targetSlug,
          version,
          requestId,
          err: msg,
        },
        "service-level env config read failed"
      );
    }
  }
}
