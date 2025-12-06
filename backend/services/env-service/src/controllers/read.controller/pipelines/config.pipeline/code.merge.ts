// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/code.merge.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Third step in the config pipeline hierarchy:
 *   1) Read rootBag and serviceBag (DtoBags) from ctx.
 *   2) Delegate hierarchy resolution to EnvConfigReader.mergeEnvBags().
 *   3) Leave a single-item DtoBag on ctx["bag"] with proper meta, so
 *      ControllerBase.finalize() can build the wire payload via bag.toBody().
 *
 * Invariants (final handler contract):
 * - On success:
 *   - ctx["bag"] MUST contain a DtoBag<EnvServiceDto> with exactly one item.
 *   - ctx["handlerStatus"] MUST be "ok".
 *   - MUST NOT set ctx["result"].
 *   - MUST NOT set ctx["response.body"] on success.
 * - On error:
 *   - ctx["handlerStatus"] MUST be "error".
 *   - MUST set ctx["response.status"] (HTTP status code).
 *   - MUST set ctx["response.body"] to a problem+json-style object.
 *
 * Behavior:
 * - At least one config record (root or service-level) must exist.
 * - EnvConfigReader.mergeEnvBags() is responsible for:
 *   - Enforcing singleton semantics on each bag.
 *   - Throwing with a descriptive error message when counts are invalid or
 *     no records are found.
 * - Individual services remain responsible for screaming if specific keys are missing.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvConfigReader } from "../../../../svc/EnvConfigReader";

export class CodeMergeHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Merge envConfig.rootBag and envConfig.serviceBag into a single EnvServiceDto bag on ctx['bag'] for finalize().";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "env_config_merge_start", requestId },
      "env-service.config.code.merge: enter"
    );

    try {
      const env = this.ctx.get<string>("envConfig.env") as string | undefined;
      const version = this.ctx.get<number>("envConfig.version") as
        | number
        | undefined;
      const targetSlug = this.ctx.get<string>("envConfig.targetSlug") as
        | string
        | undefined;

      const rootBag = this.ctx.get<DtoBag<EnvServiceDto>>(
        "envConfig.rootBag"
      ) as DtoBag<EnvServiceDto> | undefined;

      const serviceBag = this.ctx.get<DtoBag<EnvServiceDto>>(
        "envConfig.serviceBag"
      ) as DtoBag<EnvServiceDto> | undefined;

      if (!env || !version || !targetSlug) {
        this.failWithError({
          httpStatus: 500,
          title: "env_config_pipeline_miswired",
          detail:
            "Env-service config pipeline missing required context for merge. Ops: ensure EnvServiceConfigLoadRootHandler and EnvServiceConfigLoadServiceHandler seed envConfig.env/version/targetSlug.",
          stage: "config.merge.context.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.code.merge: envConfig.env/version/targetSlug missing on ctx; pipeline miswired.",
          logLevel: "error",
        });
        return;
      }

      try {
        // Merge the two bags via EnvConfigReader to enforce hierarchy + counts.
        const mergedBag: DtoBag<EnvServiceDto> = EnvConfigReader.mergeEnvBags(
          rootBag,
          serviceBag
        );

        const finalDto: EnvServiceDto = mergedBag.get(0);
        const total = 1;

        // Build a canonical single-item bag with proper meta for finalize().
        const { bag: wireBag } = BagBuilder.fromDtos([finalDto], {
          requestId,
          limit: total,
          total,
          cursor: null,
        });

        // Final-handler invariant: leave the bag on ctx["bag"]; finalize() will
        // call bag.toBody() and construct the wire payload.
        this.ctx.set("bag", wireBag);
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
          "env-service.config.code.merge: env config hierarchy resolved (root/service selection + merge)"
        );
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);

        const isNotFound = msg.startsWith("ENV_CONFIG_NOT_FOUND");
        const isMulti = msg.startsWith("ENV_CONFIG_MULTIPLE_RECORDS");

        const httpStatus = isNotFound ? 404 : 500;
        const title = isNotFound
          ? "env_config_not_found"
          : isMulti
          ? "env_config_multiple_records"
          : "env_config_hierarchy_failed";

        this.failWithError({
          httpStatus,
          title,
          detail: msg,
          stage: isNotFound
            ? "config.merge.not_found"
            : isMulti
            ? "config.merge.multiple_records"
            : "config.merge.failed",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.config.code.merge: env config hierarchy resolution failed.",
          logLevel: isNotFound ? "warn" : "error",
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
          "env-service.config.code.merge: env config hierarchy resolution failed"
        );

        return;
      }
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "env_config_merge_handler_failure",
        detail:
          "Unhandled exception while merging env config bags. Ops: inspect logs for requestId and stack frame.",
        stage: "config.merge.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.config.code.merge: unhandled exception in handler execute().",
        logLevel: "error",
      });
    } finally {
      this.log.debug(
        { event: "env_config_merge_end", requestId },
        "env-service.config.code.merge: exit"
      );
    }
  }
}
