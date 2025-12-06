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
 *
 * Purpose:
 * - First step of the /config pipeline:
 *     GET /api/env-service/v1/env-service/config?slug=&version=&env=
 *
 * Responsibilities:
 * - Parse/validate query: slug, version, env.
 * - Resolve svcEnv → NV_MONGO_URI / NV_MONGO_DB.
 * - Construct DbReader<EnvServiceDto>.
 * - Load the *root* config bag for slug="service-root" (root is optional).
 * - Seed the HandlerContext bus with:
 *     • envConfig.env        (logical environment label)
 *     • envConfig.version
 *     • envConfig.targetSlug (original requested slug)
 *     • envConfig.dbReader   (shared DbReader for later steps)
 *     • envConfig.rootBag    (DtoBag<EnvServiceDto>, may be empty)
 *
 * Notes:
 * - Does NOT throw on missing root config; that is handled by merge step.
 * - DB failures are fatal (500) with explicit Ops guidance.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvConfigReader } from "../../../../svc/EnvConfigReader";

export class DbReadRootHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Validate env-service /config query, construct DbReader<EnvServiceDto>, load root config (slug=service-root), and seed envConfig.* on the HandlerContext bus.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "env_config_root_db_read_start", requestId },
      "env-service.config.db.readRoot: enter"
    );

    try {
      const rawQuery = this.ctx.get("query");
      const query =
        rawQuery && typeof rawQuery === "object"
          ? (rawQuery as Record<string, unknown>)
          : {};

      const slugRaw = typeof query.slug === "string" ? query.slug.trim() : "";
      const versionRaw =
        typeof query.version === "string" ? query.version.trim() : "";
      const envParam = typeof query.env === "string" ? query.env.trim() : "";

      // env (logical environment label) is required; no fallbacks.
      const envLabel = envParam;

      let version: number | undefined;
      if (versionRaw) {
        const n = Number(versionRaw);
        if (Number.isFinite(n) && n > 0) {
          version = Math.trunc(n);
        }
      }

      // ---- Validate slug (target service), version, and env -----------------
      if (!slugRaw) {
        this.failWithError({
          httpStatus: 400,
          title: "bad_request_missing_slug",
          detail:
            "Query parameter 'slug' is required. Example: GET /api/env-service/v1/env-service/config?slug=gateway&version=1&env=dev",
          stage: "config.readRoot.slug.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.readRoot: missing required query parameter 'slug'.",
          logLevel: "warn",
        });
        return;
      }

      if (!version) {
        this.failWithError({
          httpStatus: 400,
          title: "bad_request_invalid_version",
          detail:
            "Query parameter 'version' is required and must be a positive integer. Example: GET /api/env-service/v1/env-service/config?slug=gateway&version=1&env=dev",
          stage: "config.readRoot.version.invalid",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.readRoot: missing or invalid query parameter 'version'.",
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
          stage: "config.readRoot.env.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.readRoot: missing required query parameter 'env'.",
          logLevel: "warn",
        });
        return;
      }

      // ---- svcEnv must already be wired by AppBase/ControllerBase ----------
      const svcEnv = this.controller.getSvcEnv?.();
      if (!svcEnv || typeof svcEnv.getEnvVar !== "function") {
        this.failWithError({
          httpStatus: 500,
          title: "service_env_unavailable",
          detail:
            "Service environment configuration is unavailable. Ops: ensure AppBase/ControllerBase seeds svcEnv with NV_MONGO_URI/NV_MONGO_DB.",
          stage: "config.readRoot.svcEnv.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.readRoot: svcEnv missing or getEnvVar not implemented.",
          logLevel: "error",
        });
        return;
      }

      let mongoUri: string;
      let mongoDb: string;
      try {
        mongoUri = svcEnv.getEnvVar("NV_MONGO_URI");
        mongoDb = svcEnv.getEnvVar("NV_MONGO_DB");
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "service_db_config_missing",
          detail:
            (err as Error)?.message ??
            "Missing NV_MONGO_URI/NV_MONGO_DB in env-service configuration. Ops: ensure these keys exist and are valid.",
          stage: "config.readRoot.svcEnv.vars",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.readRoot: svcEnv.getEnvVar(NV_MONGO_URI/NV_MONGO_DB) threw.",
          logLevel: "error",
        });
        return;
      }

      // ---- Construct DbReader<EnvServiceDto> --------------------------------
      let dbReader: DbReader<EnvServiceDto>;
      try {
        dbReader = new DbReader<EnvServiceDto>({
          dtoCtor: EnvServiceDto,
          mongoUri,
          mongoDb,
          validateReads: false,
        });
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "db_reader_init_failed",
          detail:
            (err as Error)?.message ??
            "Failed to construct DbReader for env-service. Ops: verify Mongo URI/DB and DTO wiring.",
          stage: "config.readRoot.dbReader.init",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.readRoot: DbReader<EnvServiceDto> construction failed.",
          logLevel: "error",
        });
        return;
      }

      const rootSlug = "service-root";

      this.log.debug(
        {
          event: "env_config_root_load_start",
          envLabel,
          rootSlug,
          targetSlug: slugRaw,
          version,
          requestId,
        },
        "env-service.config.db.readRoot: loading root env-service config (slug=service-root)"
      );

      // ---- Load root config (root is logically optional) -------------------
      let rootBag: DtoBag<EnvServiceDto>;
      try {
        rootBag = await EnvConfigReader.getEnv(dbReader, {
          env: envLabel,
          slug: rootSlug,
          version,
        });
      } catch (err) {
        // DB-level failure; root itself is logically optional, but this is a hard failure.
        this.failWithError({
          httpStatus: 500,
          title: "env_config_root_read_failed",
          detail:
            (err as Error)?.message ??
            "Failed to read root env-service configuration. Ops: check DB connectivity, indexes, and env-service collection.",
          stage: "config.readRoot.db.read_failed",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.db.readRoot: root env config read failed.",
          logLevel: "error",
        });

        this.log.error(
          {
            event: "env_config_root_load_error",
            envLabel,
            rootSlug,
            targetSlug: slugRaw,
            version,
            requestId,
            err: (err as Error)?.message ?? String(err),
          },
          "env-service.config.db.readRoot: root env config read failed"
        );

        return;
      }

      this.log.debug(
        {
          event: "env_config_root_load_ok",
          envLabel,
          rootSlug,
          targetSlug: slugRaw,
          version,
          rootCount: rootBag.count(),
          requestId,
        },
        "env-service.config.db.readRoot: root env config loaded"
      );

      // ---- Seed the bus for downstream handlers ----------------------------
      this.ctx.set("envConfig.env", envLabel);
      this.ctx.set("envConfig.version", version);
      this.ctx.set("envConfig.targetSlug", slugRaw);
      this.ctx.set("envConfig.dbReader", dbReader);
      this.ctx.set("envConfig.rootBag", rootBag);

      this.ctx.set("handlerStatus", "ok");
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "env_config_root_handler_failure",
        detail:
          "Unhandled exception while loading root env config. Ops: inspect logs for requestId and stack frame.",
        stage: "config.readRoot.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.config.db.readRoot: unhandled exception in handler execute().",
        logLevel: "error",
      });
    } finally {
      this.log.debug(
        { event: "env_config_root_db_read_end", requestId },
        "env-service.config.db.readRoot: exit"
      );
    }
  }
}
