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
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Final step in the config pipeline hierarchy:
 *   1) Read rootBag and serviceBag (DtoBags) from ctx.
 *   2) Delegate hierarchy resolution to EnvConfigReader.mergeEnvBags().
 *   3) Leave a single-item DtoBag on ctx["bag"] so ControllerBase.finalize()
 *      can build the wire payload via bag.toBody().
 *
 * Final handler invariants:
 * - On success:
 *   - ctx["bag"] MUST contain a DtoBag<EnvServiceDto> with exactly one item.
 *   - ctx["handlerStatus"] MUST be "ok".
 *   - MUST NOT set ctx["result"].
 *   - MUST NOT set ctx["response.body"] on success.
 * - On error:
 *   - Use failWithError() (sets ctx["error"] + ctx["status"]).
 *   - MUST NOT “manually” write response.status/body here.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { EnvConfigReader } from "../../../../svc/EnvConfigReader";

export class CodeMergeHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "code.merge";
  }

  protected handlerPurpose(): string {
    return "Merge envConfig.rootBag and envConfig.serviceBag into a singleton EnvServiceDto DtoBag on ctx['bag'] for finalize().";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "env_config_merge_start", requestId },
      "env-service.config.code.merge: enter"
    );

    const env = this.safeCtxGet<string>("envConfig.env");
    const version = this.safeCtxGet<number>("envConfig.version");
    const targetSlug = this.safeCtxGet<string>("envConfig.targetSlug");

    const rootBag = this.safeCtxGet<DtoBag<EnvServiceDto>>("envConfig.rootBag");
    const serviceBag = this.safeCtxGet<DtoBag<EnvServiceDto>>(
      "envConfig.serviceBag"
    );

    if (!env || !version || !targetSlug) {
      this.failWithError({
        httpStatus: 500,
        title: "env_config_pipeline_miswired",
        detail:
          "Env-service config pipeline missing required context for merge. Ops: ensure root/service read handlers seed envConfig.env/version/targetSlug.",
        stage: "code.merge:context.missing",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            hasEnv: !!env,
            hasVersion: !!version,
            hasTargetSlug: !!targetSlug,
            hasRootBag: !!rootBag,
            hasServiceBag: !!serviceBag,
          },
        ],
        logMessage:
          "env-service.config.code.merge: envConfig.env/version/targetSlug missing on ctx; pipeline miswired.",
        logLevel: "error",
      });
      return;
    }

    try {
      const mergedBag: DtoBag<EnvServiceDto> = EnvConfigReader.mergeEnvBags(
        rootBag,
        serviceBag
      );

      // Final-handler invariant: leave the DtoBag on ctx["bag"].
      this.ctx.set("bag", mergedBag);
      this.ctx.set("handlerStatus", "ok");

      const finalDto = mergedBag.getSingleton?.()
        ? (mergedBag.getSingleton() as EnvServiceDto)
        : (mergedBag.get(0) as EnvServiceDto);

      const hasRoot = !!rootBag && rootBag.count() > 0;
      const hasService = !!serviceBag && serviceBag.count() > 0;

      this.log.info(
        {
          event: "env_config_hierarchy_ok",
          env: (finalDto as any).env,
          slug: (finalDto as any).slug,
          version: (finalDto as any).version,
          hasRoot,
          hasService,
          requestId,
        },
        "env-service.config.code.merge: env config hierarchy resolved"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "unknown");
      const isNotFound = msg.startsWith("ENV_CONFIG_NOT_FOUND");
      const isMulti = msg.startsWith("ENV_CONFIG_MULTIPLE_RECORDS");

      this.failWithError({
        httpStatus: isNotFound ? 404 : 500,
        title: isNotFound
          ? "env_config_not_found"
          : isMulti
          ? "env_config_multiple_records"
          : "env_config_hierarchy_failed",
        detail: msg,
        stage: isNotFound
          ? "code.merge:not_found"
          : isMulti
          ? "code.merge:multiple_records"
          : "code.merge:merge_failed",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.config.code.merge: env config hierarchy resolution failed.",
        logLevel: isNotFound ? "warn" : "error",
      });

      // No extra log call. failWithError already emits the structured error record.
      return;
    }

    this.log.debug(
      { event: "env_config_merge_end", requestId },
      "env-service.config.code.merge: exit"
    );
  }
}
