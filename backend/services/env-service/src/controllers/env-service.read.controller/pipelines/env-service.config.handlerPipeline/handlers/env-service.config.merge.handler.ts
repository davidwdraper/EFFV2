// backend/services/env-service/src/controllers/env-service.read.controller/pipelines/env-service.config.handlerPipeline/handlers/env-service.config.merge.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Third step in the config pipeline hierarchy:
 *   1) Read rootBag and serviceBag (DtoBags) from ctx.
 *   2) Delegate hierarchy resolution to EnvConfigReader.mergeEnvBags().
 *   3) Return a DtoBag-style wire envelope: { items:[dtoJson], meta:{...} }.
 *
 * Invariants:
 * - At least one config record (root or service-level) must exist.
 * - If either DtoBag contains >1 DTO, mergeEnvBags() throws with an error
 *   indicating invalid counts (index/config corruption).
 * - Individual services are responsible for screaming if specific keys are missing.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvConfigReader } from "../../../../../svc/EnvConfigReader";

export class EnvServiceConfigMergeHandler extends HandlerBase {
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

    const rootBag = this.ctx.get<DtoBag<EnvServiceDto>>("envConfig.rootBag") as
      | DtoBag<EnvServiceDto>
      | undefined;

    const serviceBag = this.ctx.get<DtoBag<EnvServiceDto>>(
      "envConfig.serviceBag"
    ) as DtoBag<EnvServiceDto> | undefined;

    if (!env || !version || !targetSlug) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_CONFIG_PIPELINE_MISWIRED",
        title: "Internal Error",
        detail:
          "Env-service config pipeline missing required context for merge. Ops: ensure EnvServiceConfigLoadRootHandler and EnvServiceConfigLoadServiceHandler seed envConfig.env/version/targetSlug.",
        requestId,
      });
      return;
    }

    try {
      // New API: merge the two bags via EnvConfigReader.
      const mergedBag: DtoBag<EnvServiceDto> = EnvConfigReader.mergeEnvBags(
        rootBag,
        serviceBag
      );

      const finalDto: EnvServiceDto = mergedBag.get(0);
      const items: unknown[] = [finalDto.toJson()];
      const total = 1;

      const { meta } = BagBuilder.fromDtos([], {
        requestId,
        limit: total,
        total,
        cursor: null,
      });

      this.ctx.set("response.status", 200);
      this.ctx.set("response.body", { items, meta });
      this.ctx.set("handlerStatus", "ok");

      const hasRoot = !!rootBag && rootBag.count() > 0;
      const hasService = !!serviceBag && serviceBag.count() > 0;

      this.log.info(
        {
          event: "env_config_hierarchy_ok",
          env: finalDto.env,
          slug: finalDto.slug,
          version: finalDto.version,
          hasRoot,
          hasService,
          requestId,
        },
        "env config hierarchy resolved (root/service selection + merge)"
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);

      const isNotFound = msg.startsWith("ENV_CONFIG_NOT_FOUND");
      const isMulti = msg.startsWith("ENV_CONFIG_MULTIPLE_RECORDS");

      this.ctx.set("handlerStatus", isNotFound ? "warn" : "error");
      this.ctx.set("response.status", isNotFound ? 404 : 500);
      this.ctx.set("response.body", {
        code: isNotFound
          ? "ENV_CONFIG_NOT_FOUND"
          : isMulti
          ? "ENV_CONFIG_MULTIPLE_RECORDS"
          : "ENV_CONFIG_HIERARCHY_FAILED",
        title: isNotFound ? "Not Found" : "Internal Error",
        detail: msg,
        requestId,
      });

      const logFn = isNotFound
        ? this.log.warn.bind(this.log)
        : this.log.error.bind(this.log);

      logFn(
        {
          event: "env_config_hierarchy_error",
          env,
          slug: targetSlug,
          version,
          requestId,
          err: msg,
        },
        "env config hierarchy resolution failed"
      );
    }
  }
}
