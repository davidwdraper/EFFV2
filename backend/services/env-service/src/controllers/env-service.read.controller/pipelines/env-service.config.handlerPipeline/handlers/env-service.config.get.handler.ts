// backend/services/env-service/src/controllers/env-service.read.controller/pipelines/env-service.config.handlerPipeline/handlers/env-service.config.get.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version@level)
 *   - ADR-0048 (DbReader contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Implement GET /api/env-service/v1/env-service/config?slug=&version=&env=&level=
 * - Canonical HTTP surface for other services to bootstrap their EnvServiceDto
 *   configuration without knowing document ids.
 *
 * Invariants:
 * - Uses EnvConfigReader + DbReader (same as bootstrap).
 * - Returns DtoBag wire envelope: { items:[dtoJson], meta:{...} }.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { EnvConfigReader } from "../../../../../svc/EnvConfigReader";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";

export class EnvServiceConfigGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const requestId =
      (this.ctx.get<string>("requestId") as string) || "unknown";

    const query = (this.ctx.get("query") as Record<string, unknown>) ?? {};

    const slug = typeof query.slug === "string" ? query.slug.trim() : "";
    const versionRaw =
      typeof query.version === "string" ? query.version.trim() : "";
    const envParam = typeof query.env === "string" ? query.env.trim() : "";
    const levelParam =
      typeof query.level === "string" ? query.level.trim() : "";

    const env =
      envParam ||
      (typeof process.env.NV_ENV === "string"
        ? process.env.NV_ENV.trim()
        : "") ||
      "dev";

    const level = levelParam || "service";

    let version: number | undefined;
    if (versionRaw) {
      const n = Number(versionRaw);
      if (Number.isFinite(n) && n > 0) {
        version = Math.trunc(n);
      }
    }

    if (!slug) {
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

    const reader = new DbReader<EnvServiceDto>({
      dtoCtor: EnvServiceDto,
      mongoUri,
      mongoDb,
      validateReads: false,
      idFieldName: "id",
    });

    const configReader = new EnvConfigReader(reader);

    this.log.debug(
      {
        event: "env_config_get_start",
        env,
        slug,
        version,
        level,
        requestId,
      },
      "loading EnvServiceDto via config reader"
    );

    try {
      const bag = await configReader.getConfigBag({
        env,
        slug,
        version,
        level,
      });

      const items: unknown[] = [];
      for (const dto of bag as unknown as Iterable<EnvServiceDto>) {
        items.push(dto.toJson());
      }

      const total = items.length;
      const { meta } = BagBuilder.fromDtos([], {
        requestId,
        limit: total || 1,
        total,
        cursor: null,
      });

      this.ctx.set("response.status", 200);
      this.ctx.set("response.body", { items, meta });
      this.ctx.set("handlerStatus", "ok");

      this.log.info(
        {
          event: "env_config_get_ok",
          env,
          slug,
          version,
          level,
          total,
          requestId,
        },
        "env config returned"
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isNotFound = msg.startsWith("ENV_CONFIG_NOT_FOUND");

      this.ctx.set("handlerStatus", isNotFound ? "warn" : "error");
      this.ctx.set("response.status", isNotFound ? 404 : 500);
      this.ctx.set("response.body", {
        code: isNotFound ? "ENV_CONFIG_NOT_FOUND" : "ENV_CONFIG_READ_FAILED",
        title: isNotFound ? "Not Found" : "Internal Error",
        detail: msg,
        requestId,
      });

      const logFn = isNotFound
        ? this.log.warn.bind(this.log)
        : this.log.error.bind(this.log);
      logFn(
        {
          event: "env_config_get_error",
          env,
          slug,
          version,
          level,
          requestId,
          err: msg,
        },
        "env config read failed"
      );
    }
  }
}
