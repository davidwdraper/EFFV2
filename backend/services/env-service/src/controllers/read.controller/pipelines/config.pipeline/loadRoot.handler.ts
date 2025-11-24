// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/config.loadRoot.handler.ts
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
 *     • envConfig.env
 *     • envConfig.version
 *     • envConfig.targetSlug   (original requested slug)
 *     • envConfig.dbReader     (shared DbReader for later steps)
 *     • envConfig.rootBag      (DtoBag<EnvServiceDto>, may be empty)
 *
 * Notes:
 * - Does NOT throw on missing root config; that is handled by merge step.
 * - DB failures are fatal (500) with explicit Ops guidance.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvConfigReader } from "../../../../svc/EnvConfigReader";

export class EnvServiceConfigLoadRootHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const requestId =
      (this.ctx.get<string>("requestId") as string) || "unknown";

    const query = (this.ctx.get("query") as Record<string, unknown>) ?? {};

    const slugRaw = typeof query.slug === "string" ? query.slug.trim() : "";
    const versionRaw =
      typeof query.version === "string" ? query.version.trim() : "";
    const envParam = typeof query.env === "string" ? query.env.trim() : "";

    // Determine env with sane defaults (same as bootstrap).
    const envName =
      envParam ||
      (typeof process.env.NV_ENV === "string"
        ? process.env.NV_ENV.trim()
        : "") ||
      "dev";

    let version: number | undefined;
    if (versionRaw) {
      const n = Number(versionRaw);
      if (Number.isFinite(n) && n > 0) {
        version = Math.trunc(n);
      }
    }

    // Validate slug (target service) and version; root is always "service-root".
    if (!slugRaw) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_MISSING_SLUG",
        title: "Bad Request",
        detail:
          "Query parameter 'slug' is required. Example: GET /api/env-service/v1/env-service/config?slug=gateway&version=1",
        requestId,
      });
      return;
    }

    if (!version) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_INVALID_VERSION",
        title: "Bad Request",
        detail:
          "Query parameter 'version' is required and must be a positive integer. Example: GET /api/env-service/v1/env-service/config?slug=gateway&version=1",
        requestId,
      });
      return;
    }

    // svcEnv must already be wired by AppBase/ControllerBase.
    const svcEnv = this.controller.getSvcEnv?.();
    if (!svcEnv || typeof svcEnv.getEnvVar !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "SERVICE_ENV_UNAVAILABLE",
        title: "Internal Error",
        detail:
          "Service environment configuration is unavailable. Ops: ensure AppBase/ControllerBase seeds svcEnv with NV_MONGO_URI/NV_MONGO_DB.",
        requestId,
      });
      return;
    }

    let mongoUri: string;
    let mongoDb: string;
    try {
      mongoUri = svcEnv.getEnvVar("NV_MONGO_URI");
      mongoDb = svcEnv.getEnvVar("NV_MONGO_DB");
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "SERVICE_DB_CONFIG_MISSING",
        title: "Internal Error",
        detail:
          (err?.message as string) ??
          "Missing NV_MONGO_URI/NV_MONGO_DB in env-service configuration. Ops: ensure these keys exist and are valid.",
        requestId,
      });
      return;
    }

    let dbReader: DbReader<EnvServiceDto>;
    try {
      dbReader = new DbReader<EnvServiceDto>({
        dtoCtor: EnvServiceDto,
        mongoUri,
        mongoDb,
        validateReads: false,
      });
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "DB_READER_INIT_FAILED",
        title: "Internal Error",
        detail:
          (err?.message as string) ??
          "Failed to construct DbReader for env-service. Ops: verify Mongo URI/DB and DTO wiring.",
        requestId,
      });
      return;
    }

    const rootSlug = "service-root";

    this.log.debug(
      {
        event: "env_config_root_load_start",
        env: envName,
        rootSlug,
        targetSlug: slugRaw,
        version,
        requestId,
      },
      "loading root env-service config (slug=service-root)"
    );

    let rootBag: DtoBag<EnvServiceDto>;
    try {
      rootBag = await EnvConfigReader.getEnv(dbReader, {
        env: envName,
        slug: rootSlug,
        version,
      });
    } catch (err: any) {
      // DB-level failure; root itself is logically optional, but this is a hard failure.
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_CONFIG_ROOT_READ_FAILED",
        title: "Internal Error",
        detail:
          (err?.message as string) ??
          "Failed to read root env-service configuration. Ops: check DB connectivity, indexes, and env-service collection.",
        requestId,
      });

      this.log.error(
        {
          event: "env_config_root_load_error",
          env: envName,
          rootSlug,
          targetSlug: slugRaw,
          version,
          requestId,
          err: err?.message ?? String(err),
        },
        "root env config read failed"
      );

      return;
    }

    this.log.debug(
      {
        event: "env_config_root_load_ok",
        env: envName,
        rootSlug,
        targetSlug: slugRaw,
        version,
        rootCount: rootBag.count(),
        requestId,
      },
      "root env config loaded"
    );

    // Seed the bus for downstream handlers.
    this.ctx.set("envConfig.env", envName);
    this.ctx.set("envConfig.version", version);
    this.ctx.set("envConfig.targetSlug", slugRaw);
    this.ctx.set("envConfig.dbReader", dbReader);
    this.ctx.set("envConfig.rootBag", rootBag);

    this.ctx.set("handlerStatus", "ok");
  }
}
