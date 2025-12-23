// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/db.readRoot.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0047 (DtoBag — bagged DTO transport)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - First step of the /config pipeline:
 *     GET /api/env-service/v1/env-service/config?slug=&version=&env=
 *
 * Responsibilities:
 * - Parse/validate query: slug, version, env.
 * - Resolve sandbox → NV_MONGO_URI / NV_MONGO_DB (no svcEnv plumbing reads here).
 * - Construct DbReader<EnvServiceDto>.
 * - Load the root config bag for slug="service-root" (root is optional).
 * - Seed ctx with:
 *     • envConfig.env
 *     • envConfig.version
 *     • envConfig.targetSlug
 *     • envConfig.dbReader
 *     • envConfig.rootBag
 *
 * Notes:
 * - Root missing is not an error; DB failures are.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvConfigReader } from "../../../../svc/EnvConfigReader";

export class DbReadRootHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.read.root";
  }

  protected handlerPurpose(): string {
    return "Validate /config query, construct DbReader<EnvServiceDto>, load root config (slug=service-root), and seed envConfig.* on the HandlerContext bus.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "env_config_root_db_read_start", requestId },
      "env-service.config.db.readRoot: enter"
    );

    // ---- Parse query (strict, no fallbacks) --------------------------------
    const rawQuery = this.safeCtxGet<unknown>("query");
    const query =
      rawQuery && typeof rawQuery === "object"
        ? (rawQuery as Record<string, unknown>)
        : {};

    const targetSlug = typeof query.slug === "string" ? query.slug.trim() : "";
    const versionRaw =
      typeof query.version === "string" ? query.version.trim() : "";
    const envLabel = typeof query.env === "string" ? query.env.trim() : "";

    if (!targetSlug) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_slug",
        detail:
          "Query parameter 'slug' is required. Example: GET /api/env-service/v1/env-service/config?slug=gateway&version=1&env=dev",
        stage: "db.read.root:query.slug",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "env-service.config.db.readRoot: missing query 'slug'.",
        logLevel: "warn",
      });
      return;
    }

    const versionNum = Number(versionRaw);
    const version =
      Number.isInteger(versionNum) && versionNum > 0 ? versionNum : undefined;

    if (!version) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_invalid_version",
        detail:
          "Query parameter 'version' is required and must be a positive integer. Example: GET /api/env-service/v1/env-service/config?slug=gateway&version=1&env=dev",
        stage: "db.read.root:query.version",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.config.db.readRoot: missing/invalid query 'version'.",
        logLevel: "warn",
      });
      return;
    }

    if (!envLabel) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_env",
        detail:
          "Query parameter 'env' is required and must be a non-empty string. Example: GET /api/env-service/v1/env-service/config?slug=gateway&version=1&env=dev",
        stage: "db.read.root:query.env",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "env-service.config.db.readRoot: missing query 'env'.",
        logLevel: "warn",
      });
      return;
    }

    // ---- DB config (sandbox rails) -----------------------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // ---- Construct DbReader<EnvServiceDto> ---------------------------------
    const dbReader = new DbReader<EnvServiceDto>({
      dtoCtor: EnvServiceDto,
      mongoUri,
      mongoDb,
      validateReads: false,
    });

    const rootSlug = "service-root";

    this.log.debug(
      {
        event: "env_config_root_load_start",
        envLabel,
        rootSlug,
        targetSlug,
        version,
        requestId,
      },
      "env-service.config.db.readRoot: loading root config (slug=service-root)"
    );

    // ---- Load root config (logically optional; DB failures are fatal) -------
    let rootBag: DtoBag<EnvServiceDto>;
    try {
      rootBag = await EnvConfigReader.getEnv(dbReader, {
        env: envLabel,
        slug: rootSlug,
        version,
      });
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "env_config_root_read_failed",
        detail:
          err instanceof Error
            ? err.message
            : "Failed to read root env-service configuration. Ops: check DB connectivity, indexes, and env-service collection.",
        stage: "db.read.root:db.read",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.config.db.readRoot: root env config read failed.",
        logLevel: "error",
      });
      return;
    }

    this.log.debug(
      {
        event: "env_config_root_load_ok",
        envLabel,
        rootSlug,
        targetSlug,
        version,
        rootCount: rootBag.count(),
        requestId,
      },
      "env-service.config.db.readRoot: root env config loaded"
    );

    // ---- Seed bus for downstream handlers ----------------------------------
    this.ctx.set("envConfig.env", envLabel);
    this.ctx.set("envConfig.version", version);
    this.ctx.set("envConfig.targetSlug", targetSlug);
    this.ctx.set("envConfig.dbReader", dbReader);
    this.ctx.set("envConfig.rootBag", rootBag);

    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "env_config_root_db_read_end", requestId },
      "env-service.config.db.readRoot: exit"
    );
  }
}
