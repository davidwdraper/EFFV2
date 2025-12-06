// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/db.read.ts
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
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { EnvConfigReader } from "../../../../svc/EnvConfigReader";

export class DbReadHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Load service-level env-service config into envConfig.serviceBag using a shared DbReader seeded earlier in the config pipeline.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "env_config_service_db_read_start",
        requestId,
      },
      "env-service.config.db.read: enter"
    );

    try {
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
        this.failWithError({
          httpStatus: 500,
          title: "env_config_pipeline_miswired",
          detail:
            "Env-service config pipeline missing required context. Ops: ensure EnvServiceConfigLoadRootHandler runs and seeds envConfig.env/version/targetSlug/dbReader before EnvServiceConfigLoadServiceHandler.",
          stage: "env.config.dbRead.context.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.read: envConfig.env/version/targetSlug/dbReader missing on ctx; pipeline miswired.",
          logLevel: "error",
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
        "env-service.config.db.read: loading service-level env-service config (slug=target service)"
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
          "env-service.config.db.read: service-level env config loaded"
        );
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
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
            "env-service.config.db.read: no service-level env config found; pipeline will fall back to root-only config if present"
          );

          this.ctx.set("handlerStatus", "ok");
          return;
        }

        this.failWithError({
          httpStatus: 500,
          title: "env_config_service_read_failed",
          detail: msg,
          stage: "env.config.dbRead.read_failed",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.read: service-level env config read failed.",
          logLevel: "error",
        });
        return;
      }
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "env_config_service_handler_failure",
        detail:
          "Unhandled exception while loading service-level env config. Ops: inspect logs for requestId and stack frame.",
        stage: "env.config.dbRead.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.config.db.read: unhandled exception in handler execute().",
        logLevel: "error",
      });
    } finally {
      this.log.debug(
        { event: "env_config_service_db_read_end", requestId },
        "env-service.config.db.read: exit"
      );
    }
  }
}
