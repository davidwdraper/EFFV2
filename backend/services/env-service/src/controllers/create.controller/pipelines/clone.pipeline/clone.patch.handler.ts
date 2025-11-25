// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/handlers/clone.patch.handler.ts
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
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import type { IDto } from "@nv/shared/dto/IDto";

export class EnvServiceClonePatchHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const existingBag =
      this.ctx.get<DtoBag<EnvServiceDto>>("clone.existingBag");
    const targetSlug = String(this.ctx.get("clone.targetSlug") ?? "").trim();

    if (!existingBag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "CLONE_SOURCE_BAG_MISSING",
        title: "Internal Error",
        detail:
          "Source DtoBag not found on context. Ops: ensure the query handler populated 'clone.existingBag'.",
        requestId: this.ctx.get("requestId"),
      });
      return;
    }

    if (!targetSlug) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "CLONE_TARGET_SLUG_MISSING",
        title: "Bad Request",
        detail:
          "clone.targetSlug is required in the route as the new slug for the cloned DTO.",
        requestId: this.ctx.get("requestId"),
      });
      return;
    }

    let sourceDto: EnvServiceDto;
    try {
      // Uses your DtoBag helper; expected to throw if not singleton.
      sourceDto = existingBag.getSingleton() as EnvServiceDto;
    } catch (e) {
      const message = (e as Error)?.message ?? "Expected a singleton bag.";
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "CLONE_SOURCE_SINGLETON_BREACH",
        title: "Internal Error",
        detail: message,
        requestId: this.ctx.get("requestId"),
      });
      this.log.warn(
        { event: "clone_singleton_breach", message },
        "EnvServiceClonePatchHandler — getSingleton() failed"
      );
      return;
    }

    if (!(sourceDto instanceof EnvServiceDto)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "TYPE_MISMATCH",
        title: "Bad Request",
        detail:
          "Expected EnvServiceDto in clone.existingBag singleton; pipeline wiring mismatch.",
        requestId: this.ctx.get("requestId"),
      });
      return;
    }

    // Build a NEW EnvServiceDto from the source JSON, but intentionally strip
    // the _id so the cloned document gets a fresh id at write time.
    const srcJson = sourceDto.toJson() as any;
    delete srcJson._id;

    const cloned = EnvServiceDto.fromJson(srcJson, { validate: false });

    // Apply new slug; keep env/version/vars the same.
    cloned.slug = targetSlug;

    // ID handling:
    // - We explicitly removed _id from srcJson before hydration.
    // - EnvServiceDto.fromJson() will NOT set an id when _id is absent.
    // - DbWriter.ensureId() will assign a fresh id at write time (ADR-0057).
    // - Handlers must not touch IDs directly.

    this.log.debug(
      {
        event: "clone_patch",
        oldSlug: (sourceDto as any).slug,
        newSlug: targetSlug,
        requestId: this.ctx.get("requestId"),
      },
      "patched cloned EnvServiceDto with new slug"
    );

    // Re-bag as a singleton, mirroring update/create patterns.
    const dtos: IDto[] = [cloned as unknown as IDto];
    const { bag: clonedBag } = BagBuilder.fromDtos(dtos, {
      requestId: this.ctx.get("requestId") ?? "unknown",
      limit: 1,
      cursor: null,
      total: 1,
    });

    (clonedBag as any)?.sealSingleton?.(); // safe no-op if not implemented

    this.ctx.set("bag", clonedBag);
    this.ctx.set("handlerStatus", "ok");
  }
}
