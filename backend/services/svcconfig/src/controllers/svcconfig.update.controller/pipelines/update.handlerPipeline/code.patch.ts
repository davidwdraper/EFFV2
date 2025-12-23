// backend/services/svcconfig/src/controllers/svcconfig.update.controller/pipelines/update.handlerPipeline/code.patch.ts
/**
 * Docs:
 * - ADR-0041/0042 (Handlers, Context Bus)
 * - ADR-0048 (All reads return DtoBag)
 * - ADR-0050 (Wire Bag Envelope; singleton inbound)
 * - ADR-0053 (Bag Purity; bag-centric processing)
 * - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Patch the **existing** entity (from ctx["existingBag"]) using the client **patch**
 *   payload (from ctx["bag"]) — both are **singleton DtoBags<SvcconfigDto>**.
 * - Output a **singleton DtoBag<SvcconfigDto>** with the UPDATED DTO and replace ctx["bag"] with it.
 *
 * Inputs (ctx):
 * - "existingBag": DtoBag<SvcconfigDto>   (singleton; from LoadExistingUpdateHandler)
 * - "bag": DtoBag<SvcconfigDto>           (singleton; from BagPopulateGetHandler — the patch)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<SvcconfigDto>           (REPLACED with updated singleton bag)
 * - "handlerStatus": "ok" | "error"
 * - "status": number
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { SvcconfigDto } from "@nv/shared/dto/svcconfig.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import type { IDto } from "@nv/shared/dto/IDto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";

export class CodePatchHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Handler naming convention:
   * - code.<primaryFunction>[.<sub>...]
   *
   * For svcconfig update:
   * - Primary function: svcconfig.update.patch
   */
  public handlerName(): string {
    return "code.svcconfig.update.patch";
  }

  protected handlerPurpose(): string {
    return "Apply a patch DtoBag<SvcconfigDto> onto an existing singleton bag and replace ctx['bag'] with the updated singleton.";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    // ---- Fetch typed bags ---------------------------------------------------
    const existingBag = this.safeCtxGet<DtoBag<SvcconfigDto>>("existingBag");
    const patchBag = this.safeCtxGet<DtoBag<SvcconfigDto>>("bag");

    if (!existingBag || !patchBag) {
      this.failWithError({
        httpStatus: 500,
        title: "internal_error",
        detail:
          "Required bags not found on context. Ops: ensure LoadExistingUpdateHandler set 'existingBag' and BagPopulateGetHandler set 'bag'.",
        stage: "svcconfig.update.patch.bags",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            key: "existingBag",
            present: !!existingBag,
          },
          {
            key: "bag",
            present: !!patchBag,
          },
        ],
        logMessage:
          "CodePatchHandler.execute missing required bags for svcconfig update patch",
        logLevel: "error",
      });
      return;
    }

    const existingItems = Array.from(existingBag.items());
    const patchItems = Array.from(patchBag.items());

    // ---- Enforce singleton semantics on both inputs -------------------------
    if (existingItems.length !== 1) {
      const notFound = existingItems.length === 0;
      this.failWithError({
        httpStatus: notFound ? 404 : 500,
        title: notFound ? "not_found" : "internal_error",
        detail: notFound
          ? "No existing record found for supplied id."
          : "Invariant breach: multiple records matched primary key lookup.",
        stage: "svcconfig.update.patch.existing_singleton",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            bag: "existingBag",
            length: existingItems.length,
          },
        ],
        logMessage: notFound
          ? "CodePatchHandler.execute no existing record for svcconfig update"
          : "CodePatchHandler.execute multiple existing records for svcconfig update",
        logLevel: notFound ? "warn" : "error",
      });
      return;
    }

    if (patchItems.length !== 1) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request",
        detail:
          patchItems.length === 0
            ? "Update requires exactly one patch item; received 0."
            : "Update requires exactly one patch item; received more than 1.",
        stage: "svcconfig.update.patch.patch_singleton",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            bag: "bag",
            length: patchItems.length,
          },
        ],
        logMessage:
          "CodePatchHandler.execute invalid patch bag cardinality for svcconfig update",
        logLevel: "warn",
      });
      return;
    }

    const existing = existingItems[0];
    const patchDto = patchItems[0];

    // ---- Runtime type sanity (hard fail if pipeline wiring is wrong) -------
    if (
      !(existing instanceof SvcconfigDto) ||
      !(patchDto instanceof SvcconfigDto)
    ) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request",
        detail:
          "DtoBag type mismatch: expected SvcconfigDto for both existing and patch items.",
        stage: "svcconfig.update.patch.type_guard",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            expected: "SvcconfigDto",
            actualExisting: existing?.constructor?.name,
            actualPatch: patchDto?.constructor?.name,
          },
        ],
        logMessage:
          "CodePatchHandler.execute svcconfig DtoBag type mismatch for update",
        logLevel: "error",
      });
      return;
    }

    // ---- Apply patch via DTO authority -------------------------------------
    try {
      const patchJson = patchDto.toBody() as Record<string, unknown>;
      existing.patchFrom(patchJson); // no options object
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request",
        detail: err instanceof Error ? err.message : String(err),
        stage: "svcconfig.update.patch.patchFrom",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            message: "patchFrom() threw during svcconfig update.",
          },
        ],
        rawError: err,
        logMessage:
          "CodePatchHandler.execute patchFrom() threw while applying svcconfig update",
        logLevel: "warn",
      });
      return;
    }

    // ---- Re-assert instance collection (prevents DTO_COLLECTION_UNSET) -----
    try {
      const dtoType = this.safeCtxGet<string>("dtoType"); // "svcconfig" on this route
      if (
        dtoType &&
        typeof (this.controller as any).getDtoRegistry === "function"
      ) {
        const reg: IDtoRegistry = (this.controller as any).getDtoRegistry();
        const coll = reg.dbCollectionNameByType(dtoType);
        if (coll && typeof (existing as any).setCollectionName === "function") {
          (existing as any).setCollectionName(coll);
        }
      }
    } catch (err) {
      // non-fatal; DbWriter will enforce collection presence
      this.log.warn(
        {
          event: "collection_name_reassert_failed",
          handler: this.handlerName(),
          requestId,
          error: err instanceof Error ? err.message : String(err),
        },
        "CodePatchHandler.execute failed to re-assert collection name on svcconfig DTO (non-fatal)"
      );
    }

    // ---- Re-bag the UPDATED DTO; replace ctx["bag"] -------------------------
    const dtos: IDto[] = [existing as unknown as IDto];
    const { bag: updatedBag } = BagBuilder.fromDtos(dtos, {
      requestId,
      limit: 1,
      cursor: null,
      total: 1,
    });
    (updatedBag as any)?.sealSingleton?.(); // harmless if not implemented

    this.ctx.set("bag", updatedBag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "patched",
        handler: this.handlerName(),
        singleton: true,
        requestId,
      },
      "CodePatchHandler.execute existing svcconfig DTO patched from patch bag and re-bagged"
    );
  }
}
