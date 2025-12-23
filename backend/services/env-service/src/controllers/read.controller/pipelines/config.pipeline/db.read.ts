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
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 *     GET /api/env-service/v1/env-service/config?slug=&version=&env=
 *
 * Responsibilities:
 * - Reuse the DbReader<EnvServiceDto> created by DbReadRootHandler.
 * - Load the service-level config bag for the requested slug.
 * - Seed ctx with:
 *     • envConfig.serviceBag (DtoBag<EnvServiceDto>, may be empty)
 *
 * Notes:
 * - “Not found” is not an error; merge handler decides how to fall back.
 * - DB-level failures are fatal (500) with explicit Ops guidance.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { EnvConfigReader } from "../../../../svc/EnvConfigReader";

export class DbReadHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.read.service";
  }

  protected handlerPurpose(): string {
    return "Load service-level env-service config into envConfig.serviceBag using a DbReader seeded earlier in the config pipeline.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "env_config_service_db_read_start", requestId },
      "env-service.config.db.read: enter"
    );

    const env = this.safeCtxGet<string>("envConfig.env");
    const version = this.safeCtxGet<number>("envConfig.version");
    const targetSlug = this.safeCtxGet<string>("envConfig.targetSlug");
    const dbReader =
      this.safeCtxGet<DbReader<EnvServiceDto>>("envConfig.dbReader");

    if (!env || !version || !targetSlug || !dbReader) {
      this.failWithError({
        httpStatus: 500,
        title: "env_config_pipeline_miswired",
        detail:
          "Env-service config pipeline missing required context. Ops: ensure DbReadRootHandler seeds envConfig.env/version/targetSlug/dbReader before DbReadHandler.",
        stage: "db.read.service:context.missing",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            hasEnv: !!env,
            hasVersion: !!version,
            hasTargetSlug: !!targetSlug,
            hasDbReader: !!dbReader,
          },
        ],
        logMessage:
          "env-service.config.db.read: envConfig.* missing on ctx; pipeline miswired.",
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
      "env-service.config.db.read: loading service-level env config (target slug)"
    );

    // EnvConfigReader.getEnv is the canonical place to decide “not found” semantics.
    // This handler treats not-found as non-fatal and simply leaves an empty bag.
    try {
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
      return;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      const isNotFound = msg.startsWith("ENV_CONFIG_NOT_FOUND");

      if (isNotFound) {
        // Non-fatal; merge decides what to do if BOTH root and service are empty.
        this.ctx.set("handlerStatus", "ok");

        this.log.info(
          {
            event: "env_config_service_not_found",
            env,
            slug: targetSlug,
            version,
            requestId,
          },
          "env-service.config.db.read: no service-level env config found; merge will decide fallback"
        );
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "env_config_service_read_failed",
        detail: msg,
        stage: "db.read.service:db.read",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.config.db.read: service-level env config read failed.",
        logLevel: "error",
      });
      return;
    }
  }
}
