// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/handlers/code.patch.ts
/**
 * Docs:
 * - Inherit controller + pipeline docs.
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Take the single EnvServiceDto in ctx["clone.existingBag"], clone it, patch it
 *   with the new slug, and replace ctx["bag"] with a singleton bag for create.
 *
 * Inputs (ctx):
 * - "clone.existingBag": DtoBag<EnvServiceDto>  (singleton; from query handler)
 * - "clone.targetSlug":  string — new slug to apply (from route :targetSlug)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<EnvServiceDto>  (singleton; cloned + patched DTO)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import type { IDto } from "@nv/shared/dto/IDto";

export class CodePatchHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "code.patch";
  }

  protected handlerPurpose(): string {
    return "Clone EnvServiceDto from clone.existingBag, apply clone.targetSlug, and emit a singleton DtoBag for create.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const existingBag =
      this.safeCtxGet<DtoBag<EnvServiceDto>>("clone.existingBag");
    const targetSlugRaw = this.safeCtxGet<unknown>("clone.targetSlug");
    const targetSlug =
      typeof targetSlugRaw === "string" ? targetSlugRaw.trim() : "";

    if (!existingBag) {
      this.failWithError({
        httpStatus: 500,
        title: "clone_source_bag_missing",
        detail:
          "Source DtoBag not found on context. Ops: ensure the query handler populated 'clone.existingBag'.",
        stage: "code.patch:missing_existing_bag",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.clone.code.patch: ctx['clone.existingBag'] missing.",
        logLevel: "error",
      });
      return;
    }

    if (!targetSlug) {
      this.failWithError({
        httpStatus: 400,
        title: "clone_target_slug_missing",
        detail:
          "clone.targetSlug is required in the route as the new slug for the cloned DTO.",
        stage: "code.patch:missing_target_slug",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.clone.code.patch: clone.targetSlug missing/empty.",
        logLevel: "warn",
      });
      return;
    }

    // Enforce singleton invariant.
    const sourceDto = this.safeGetSingleton(existingBag, requestId);
    if (!sourceDto) return;

    // Clone by round-tripping through toBody/fromBody (DTO remains canonical truth).
    const cloned = this.cloneEnvServiceDto(sourceDto, requestId);
    if (!cloned) return;

    // Apply new slug; keep env/version/vars the same.
    cloned.slug = targetSlug;

    this.log.debug(
      {
        event: "clone_patch",
        oldSlug: (sourceDto as any).slug,
        newSlug: targetSlug,
        requestId,
      },
      "env-service.clone.code.patch: patched cloned EnvServiceDto with new slug"
    );

    // Re-bag as a singleton for create.
    const clonedBag = this.buildSingletonBag(
      cloned as unknown as IDto,
      requestId
    );
    if (!clonedBag) return;

    this.ctx.set("bag", clonedBag);
    this.ctx.set("handlerStatus", "ok");
  }

  private safeGetSingleton(
    bag: DtoBag<EnvServiceDto>,
    requestId: string | undefined
  ): EnvServiceDto | undefined {
    try {
      const dto = bag.getSingleton() as unknown;
      if (!(dto instanceof EnvServiceDto)) {
        this.failWithError({
          httpStatus: 500,
          title: "clone_source_type_mismatch",
          detail:
            "Expected EnvServiceDto in clone.existingBag singleton; pipeline wiring mismatch. Ops: verify clone pipeline configuration.",
          stage: "code.patch:type_check",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "safeGetSingleton" },
          logMessage:
            "env-service.clone.code.patch: clone.existingBag singleton is not EnvServiceDto.",
          logLevel: "error",
        });
        return undefined;
      }
      return dto;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Expected a singleton bag.";
      this.failWithError({
        httpStatus: 500,
        title: "clone_source_singleton_breach",
        detail: message,
        stage: "code.patch:getSingleton",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "safeGetSingleton" },
        logMessage:
          "env-service.clone.code.patch: getSingleton() failed for clone.existingBag.",
        logLevel: "error",
      });
      return undefined;
    }
  }

  private cloneEnvServiceDto(
    sourceDto: EnvServiceDto,
    requestId: string | undefined
  ): EnvServiceDto | undefined {
    try {
      const srcBody = sourceDto.toBody() as any;

      // Never carry IDs across clone boundaries.
      delete srcBody._id;

      // We intentionally skip validation here: the source was already validated on read
      // when validateReads=true. The clone will be validated on write in the create pipeline.
      return EnvServiceDto.fromBody(srcBody, { validate: false });
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "clone_source_hydration_failed",
        detail:
          "Failed to hydrate cloned EnvServiceDto from source JSON. Ops: inspect source DTO shape and EnvServiceDto.fromBody().",
        stage: "code.patch:fromBody",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "cloneEnvServiceDto" },
        logMessage:
          "env-service.clone.code.patch: EnvServiceDto.fromBody() threw while hydrating clone.",
        logLevel: "error",
      });
      return undefined;
    }
  }

  private buildSingletonBag(
    dto: IDto,
    requestId: string | undefined
  ): DtoBag<IDto> | undefined {
    try {
      const built = BagBuilder.fromDtos([dto], {
        requestId: requestId ?? "unknown",
        limit: 1,
        cursor: null,
        total: 1,
      });

      const bag = built.bag as unknown as DtoBag<IDto>;

      // If the bag supports singleton sealing, use it. If not, don’t fake it.
      if (typeof (bag as any).sealSingleton === "function") {
        (bag as any).sealSingleton();
      }

      return bag;
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "clone_bag_build_failed",
        detail:
          "Failed to build a singleton DtoBag for the cloned EnvServiceDto.",
        stage: "code.patch:bag_build",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "buildSingletonBag" },
        logMessage:
          "env-service.clone.code.patch: BagBuilder.fromDtos() threw while building cloned bag.",
        logLevel: "error",
      });
      return undefined;
    }
  }
}
