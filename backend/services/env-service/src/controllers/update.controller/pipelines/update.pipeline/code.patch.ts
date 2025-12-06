// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/code.patch.ts
/**
 * Docs:
 * - ADR-0041/0042 (Handlers, Context Bus)
 * - ADR-0048 (All reads return DtoBag)
 * - ADR-0050 (Wire Bag Envelope; singleton inbound)
 * - ADR-0053 (Bag Purity; bag-centric processing)
 *
 * Purpose:
 * - Patch the **existing** entity (from ctx["existingBag"]) using the client **patch**
 *   payload (from ctx["bag"]) — both are **singleton DtoBags<EnvServiceDto>**.
 * - Output a **singleton DtoBag<EnvServiceDto>** with the UPDATED DTO and replace ctx["bag"] with it.
 *
 * Inputs (ctx):
 * - "existingBag": DtoBag<EnvServiceDto>   (singleton; from LoadExistingUpdateHandler)
 * - "bag": DtoBag<EnvServiceDto>           (singleton; from BagPopulateGetHandler — the patch)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<EnvServiceDto>           (REPLACED with updated singleton bag)
 * - "handlerStatus": "ok" | "error"
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";

export class CodePatchHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Patch an existing EnvServiceDto from ctx['existingBag'] using a singleton patch bag on ctx['bag'], then re-bag the updated DTO back to ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "env_service_update_patch_start", requestId },
      "env-service.update.code.patch: enter"
    );

    try {
      // ---- Fetch typed bags -------------------------------------------------
      const existingBag =
        this.ctx.get<DtoBag<EnvServiceDto>>("existingBag") ?? null;
      const patchBag = this.ctx.get<DtoBag<EnvServiceDto>>("bag") ?? null;

      if (!existingBag || !patchBag) {
        this.failWithError({
          httpStatus: 500,
          title: "bags_missing",
          detail:
            "Required bags not found on context. Ops: ensure LoadExistingUpdateHandler set 'existingBag' and BagPopulateGetHandler set 'bag'.",
          stage: "update.patch.bags.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.code.patch: existingBag and/or bag missing on ctx.",
          logLevel: "error",
        });
        return;
      }

      const existingItems = Array.from(existingBag.items());
      const patchItems = Array.from(patchBag.items());

      // ---- Enforce singleton semantics on both inputs -----------------------
      if (existingItems.length !== 1) {
        const isNotFound = existingItems.length === 0;

        this.failWithError({
          httpStatus: isNotFound ? 404 : 500,
          title: isNotFound ? "not_found" : "multiple_matches",
          detail: isNotFound
            ? "No existing record found for supplied id."
            : "Invariant breach: multiple records matched primary key lookup.",
          stage: isNotFound
            ? "update.patch.existing.not_found"
            : "update.patch.existing.multiple_matches",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage: isNotFound
            ? "env-service.update.code.patch: existingBag was empty; expected singleton."
            : "env-service.update.code.patch: existingBag contained multiple records; expected singleton.",
          logLevel: isNotFound ? "warn" : "error",
        });
        return;
      }

      if (patchItems.length !== 1) {
        const isEmpty = patchItems.length === 0;

        this.failWithError({
          httpStatus: 400,
          title: isEmpty ? "empty_items" : "too_many_items",
          detail: isEmpty
            ? "Update requires exactly one patch item; received 0."
            : "Update requires exactly one patch item; received more than 1.",
          stage: isEmpty
            ? "update.patch.patchBag.empty"
            : "update.patch.patchBag.too_many",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage: isEmpty
            ? "env-service.update.code.patch: patch bag was empty; expected singleton."
            : "env-service.update.code.patch: patch bag contained multiple items; expected singleton.",
          logLevel: "warn",
        });
        return;
      }

      const existing = existingItems[0];
      const patchDto = patchItems[0];

      // ---- Runtime type sanity (hard fail if pipeline wiring is wrong) -----
      if (
        !(existing instanceof EnvServiceDto) ||
        !(patchDto instanceof EnvServiceDto)
      ) {
        this.failWithError({
          httpStatus: 400,
          title: "type_mismatch",
          detail:
            "DtoBag type mismatch: expected EnvServiceDto for both existing and patch items.",
          stage: "update.patch.type_mismatch",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.code.patch: existing and/or patch items are not EnvServiceDto instances.",
          logLevel: "error",
        });
        return;
      }

      // ---- Apply patch via DTO authority -----------------------------------
      try {
        existing.patchFromDto(patchDto);
      } catch (err) {
        this.failWithError({
          httpStatus: 400,
          title: "dto_validation_failed",
          detail:
            (err as Error)?.message ??
            "DTO validation failed while applying patch to existing EnvServiceDto.",
          stage: "update.patch.dto_validation",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.code.patch: EnvServiceDto.patchFromDto() threw during patch.",
          logLevel: "warn",
        });
        return;
      }

      // ---- Re-assert instance collection (prevents DTO_COLLECTION_UNSET) ----
      try {
        const dtoType = this.ctx.get<string>("dtoType"); // "env-service" on this route
        if (
          dtoType &&
          typeof (this.controller as any).getDtoRegistry === "function"
        ) {
          const reg: IDtoRegistry = (this.controller as any).getDtoRegistry();
          const coll = reg.dbCollectionNameByType(dtoType);
          if (
            coll &&
            typeof (existing as any).setCollectionName === "function"
          ) {
            (existing as any).setCollectionName(coll);
          }
        }
      } catch (err) {
        // non-fatal; DbWriter will enforce collection presence
        this.log.warn(
          {
            event: "update_patch_collection_reassert_failed",
            dtoType: this.ctx.get("dtoType"),
            requestId,
            err:
              err instanceof Error
                ? { message: err.message, stack: err.stack }
                : err,
          },
          "env-service.update.code.patch: failed to re-assert collection name on updated DTO (non-fatal)."
        );
      }

      // ---- Re-bag the UPDATED DTO; replace ctx["bag"] -----------------------
      let updatedBag;
      try {
        const built = BagBuilder.fromDtos([existing], {
          requestId: requestId ?? "unknown",
          limit: 1,
          cursor: null,
          total: 1,
        });
        updatedBag = built.bag;
        (updatedBag as any)?.sealSingleton?.(); // harmless if not implemented
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "bag_build_failed",
          detail:
            (err as Error)?.message ??
            "Failed to build a singleton DtoBag for the updated EnvServiceDto.",
          stage: "update.patch.bag_build",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.code.patch: BagBuilder.fromDtos() threw while building updated bag.",
          logLevel: "error",
        });
        return;
      }

      this.ctx.set("bag", updatedBag);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "patched",
          singleton: true,
          requestId,
        },
        "env-service.update.code.patch: existing DTO patched from patch bag and re-bagged"
      );
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "update_patch_handler_failure",
        detail:
          "Unhandled exception while patching existing EnvServiceDto. Ops: inspect logs for requestId and stack frame.",
        stage: "update.patch.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.update.code.patch: unhandled exception in handler execute().",
        logLevel: "error",
      });
    }
  }
}
