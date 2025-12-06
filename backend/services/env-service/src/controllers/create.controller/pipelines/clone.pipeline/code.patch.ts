// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/handlers/code.patch.ts
/**
 * Docs:
 * - Inherit controller + pipeline docs.
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

  /**
   * Handler identity for logs and diagnostics.
   */
  public handlerName(): string {
    return "code.patch";
  }

  /**
   * Short, operator-facing purpose string.
   */
  protected handlerPurpose(): string {
    return "Clone EnvServiceDto from clone.existingBag, apply clone.targetSlug, and emit a singleton DtoBag for create.";
  }

  /**
   * Execute:
   * - Validate presence and type of clone.existingBag and clone.targetSlug.
   * - Enforce singleton invariant on clone.existingBag.
   * - Clone EnvServiceDto, clear id, apply new slug.
   * - Build a singleton DtoBag and attach it to ctx[\"bag\"] for create.
   */
  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    try {
      const existingBag =
        this.ctx.get<DtoBag<EnvServiceDto>>("clone.existingBag");
      const targetSlugRaw = this.ctx.get("clone.targetSlug");
      const targetSlug =
        typeof targetSlugRaw === "string" ? targetSlugRaw.trim() : "";

      if (!existingBag) {
        this.failWithError({
          httpStatus: 500,
          title: "clone_source_bag_missing",
          detail:
            "Source DtoBag not found on context. Ops: ensure the query handler populated 'clone.existingBag'.",
          stage: "clone.patch.existingBag.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.patch: ctx['clone.existingBag'] is missing.",
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
          stage: "clone.patch.targetSlug.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.patch: clone.targetSlug is missing or empty.",
          logLevel: "warn",
        });
        return;
      }

      let sourceDto: EnvServiceDto;
      try {
        // Uses DtoBag helper; expected to throw if not singleton.
        sourceDto = existingBag.getSingleton() as EnvServiceDto;
      } catch (err) {
        const message = (err as Error)?.message ?? "Expected a singleton bag.";
        this.failWithError({
          httpStatus: 500,
          title: "clone_source_singleton_breach",
          detail: message,
          stage: "clone.patch.getSingleton",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.patch: getSingleton() failed for clone.existingBag.",
          logLevel: "error",
        });
        return;
      }

      if (!(sourceDto instanceof EnvServiceDto)) {
        this.failWithError({
          httpStatus: 500,
          title: "clone_source_type_mismatch",
          detail:
            "Expected EnvServiceDto in clone.existingBag singleton; pipeline wiring mismatch. Ops: verify clone pipeline configuration.",
          stage: "clone.patch.type_check",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.patch: singleton from clone.existingBag is not an instance of EnvServiceDto.",
          logLevel: "error",
        });
        return;
      }

      // Build a NEW EnvServiceDto from the source JSON, but intentionally strip
      // the _id so the cloned document gets a fresh id at write time.
      let cloned: EnvServiceDto;
      try {
        const srcJson = sourceDto.toBody() as any;
        delete srcJson._id;

        cloned = EnvServiceDto.fromBody(srcJson, { validate: false });
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "clone_source_hydration_failed",
          detail:
            "Failed to hydrate cloned EnvServiceDto from source JSON. Ops: inspect source DTO shape and EnvServiceDto.fromBody().",
          stage: "clone.patch.fromBody",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.patch: EnvServiceDto.fromBody() threw while hydrating cloned DTO.",
          logLevel: "error",
        });
        return;
      }

      // Apply new slug; keep env/version/vars the same.
      cloned.slug = targetSlug;

      // ID handling:
      // - We explicitly removed _id from srcJson before hydration.
      // - EnvServiceDto.fromBody() will NOT set an id when _id is absent.
      // - DbWriter.ensureId() will assign a fresh id at write time (ADR-0057).
      // - Handlers must not touch IDs directly.

      this.log.debug(
        {
          event: "clone_patch",
          oldSlug: (sourceDto as any).slug,
          newSlug: targetSlug,
          requestId,
        },
        "env-service.clone.code.patch: patched cloned EnvServiceDto with new slug"
      );

      // Re-bag as a singleton, mirroring update/create patterns.
      let clonedBag: DtoBag<IDto>;
      try {
        const dtos: IDto[] = [cloned as unknown as IDto];
        const built = BagBuilder.fromDtos(dtos, {
          requestId: requestId ?? "unknown",
          limit: 1,
          cursor: null,
          total: 1,
        });

        clonedBag = built.bag as unknown as DtoBag<IDto>;
        (clonedBag as any)?.sealSingleton?.(); // safe no-op if not implemented
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "clone_bag_build_failed",
          detail:
            "Failed to build a singleton DtoBag for the cloned EnvServiceDto.",
          stage: "clone.patch.bag_build",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.patch: BagBuilder.fromDtos() threw while building cloned bag.",
          logLevel: "error",
        });
        return;
      }

      this.ctx.set("bag", clonedBag);
      this.ctx.set("handlerStatus", "ok");
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "clone_patch_handler_failure",
        detail:
          "Unhandled exception while cloning EnvServiceDto. Ops: inspect logs for requestId and stack frame.",
        stage: "clone.patch.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.clone.code.patch: unhandled exception in handler execute().",
        logLevel: "error",
      });
    }
  }
}
