// backend/services/shared/src/http/handlers/code.patch.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; bag-centric processing
 * - ADRs:
 *   - ADR-0040/0041/0042/0043
 *   - ADR-0048 (All reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; bag-centric processing)
 *
 * Purpose:
 * - Patch the **existing** entity (from ctx["existingBag"]) using the client **patch**
 *   payload (from ctx["bag"]) — both are **singleton DtoBags<DtoBase>**.
 * - Output a **singleton DtoBag<DtoBase>** with the UPDATED DTO and replace ctx["bag"] with it.
 *
 * Inputs (ctx):
 * - "existingBag": DtoBag<DtoBase>   (singleton; from LoadExistingUpdateHandler)
 * - "bag": DtoBag<DtoBase>           (singleton; from BagPopulateGetHandler — the patch)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<DtoBase>           (REPLACED with updated singleton bag)
 * - "handlerStatus": "ok" | "error"
 * - On error only:
 *   - ctx["error"]: NvHandlerError (mapped to ProblemDetails by finalize)
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { DtoBag } from "../../dto/DtoBag";
import type { DtoBase } from "../../dto/DtoBase";
import { BagBuilder } from "../../dto/wire/BagBuilder";
import type { IDto } from "../../dto/IDto";
import type { IDtoRegistry } from "../../registry/RegistryBase";

export class CodePatchHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Patch an existing singleton DtoBag<DtoBase> using a singleton patch bag and re-bag the updated DTO onto ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "code.patch enter"
    );

    // ---- Fetch bags from context -------------------------------------------
    const existingBag = this.ctx.get<DtoBag<DtoBase>>("existingBag");
    const patchBag = this.ctx.get<DtoBag<DtoBase>>("bag");

    if (!existingBag || !patchBag) {
      this.failWithError({
        httpStatus: 500,
        title: "bags_missing",
        detail:
          "Required bags not found on context. Ops: ensure LoadExistingUpdateHandler set 'existingBag' and BagPopulateGetHandler set 'bag' before code.patch.",
        stage: "config.bags",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasExistingBag: !!existingBag,
            hasPatchBag: !!patchBag,
          },
        ],
        logMessage:
          "code.patch — required DtoBags missing from context (existingBag / bag).",
        logLevel: "error",
      });
      return;
    }

    const existingItems = Array.from(existingBag.items());
    const patchItems = Array.from(patchBag.items());

    // ---- Enforce singleton semantics on both inputs ------------------------
    if (existingItems.length !== 1) {
      const size = existingItems.length;
      const isEmpty = size === 0;
      const code = isEmpty ? "NOT_FOUND" : "MULTIPLE_MATCHES";

      this.failWithError({
        httpStatus: isEmpty ? 404 : 500,
        title: "existing_bag_singleton_violation",
        detail: isEmpty
          ? "No existing record found for supplied id."
          : "Invariant breach: multiple records matched primary key lookup.",
        stage: "business.existingSingleton",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [{ size, code }],
        logMessage:
          "code.patch — existingBag must be a singleton for patch operation.",
        logLevel: isEmpty ? "warn" : "error",
      });
      return;
    }

    if (patchItems.length !== 1) {
      const size = patchItems.length;
      const isEmpty = size === 0;
      const code = isEmpty ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS";

      this.failWithError({
        httpStatus: 400,
        title: "patch_bag_singleton_violation",
        detail: isEmpty
          ? "Update requires exactly one patch item; received 0."
          : `Update requires exactly one patch item; received ${size}.`,
        stage: "business.patchSingleton",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [{ size, code }],
        logMessage:
          "code.patch — patch bag must be a singleton for update operation.",
        logLevel: "warn",
      });
      return;
    }

    const existing = existingItems[0] as DtoBase;
    const patchDto = patchItems[0] as DtoBase;

    // ---- Runtime type sanity (ensure DTOs can be patched) ------------------
    const hasPatchShape =
      existing &&
      patchDto &&
      typeof (existing as any).patchFrom === "function" &&
      typeof (patchDto as any).toBody === "function";

    if (!hasPatchShape) {
      this.failWithError({
        httpStatus: 500,
        title: "dto_patch_capability_missing",
        detail:
          "DtoBag items do not expose the expected patchFrom/toBody methods. Dev: ensure the DTO type for this route supports patch semantics.",
        stage: "business.typeGuard",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            existingType: (existing as any)?.constructor?.name,
            patchType: (patchDto as any)?.constructor?.name,
            hasExistingPatchFrom:
              typeof (existing as any).patchFrom === "function",
            hasPatchDtoToBody: typeof (patchDto as any).toBody === "function",
          },
        ],
        logMessage:
          "code.patch — DTOs on existingBag/patch bag do not support patchFrom/toBody.",
        logLevel: "error",
      });
      return;
    }

    // ---- Apply patch via DTO authority -------------------------------------
    try {
      const patchJson = (patchDto as any).toBody() as Record<string, unknown>;
      (existing as any).patchFrom(patchJson); // DTO-level validation lives here

      this.log.debug(
        {
          event: "patched_dto",
          handler: this.constructor.name,
          requestId,
          dtoType: (existing as any)?.getDtoType?.(),
        },
        "code.patch — existing DTO patched from patch bag"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "dto_validation_failed",
        detail:
          (err as Error)?.message ??
          "DTO validation failed while applying patch payload.",
        stage: "business.patchApply",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            existingType: (existing as any)?.constructor?.name,
            patchType: (patchDto as any)?.constructor?.name,
          },
        ],
        rawError: err,
        logMessage:
          "code.patch — DTO patchFrom() threw during patch application.",
        logLevel: "warn",
      });
      return;
    }

    // ---- Re-assert instance collection (prevents DTO_COLLECTION_UNSET) -----
    try {
      const dtoType = this.ctx.get<string>("dtoType"); // e.g., "user", "auth", etc.

      if (
        dtoType &&
        typeof (this.controller as any).getDtoRegistry === "function"
      ) {
        const reg: IDtoRegistry = (this.controller as any).getDtoRegistry();
        const coll = reg.dbCollectionNameByType(dtoType);

        if (coll && typeof (existing as any).setCollectionName === "function") {
          (existing as any).setCollectionName(coll);

          this.log.debug(
            {
              event: "collection_name_set",
              handler: this.constructor.name,
              dtoType,
              collection: coll,
              requestId,
            },
            "code.patch — collection name re-asserted on patched DTO"
          );
        }
      }
    } catch (err) {
      // Non-fatal; DbWriter will enforce collection presence downstream.
      this.log.warn(
        {
          event: "collection_name_set_failed",
          handler: this.constructor.name,
          message: (err as Error)?.message,
          requestId,
        },
        "code.patch — failed to re-assert collection name on DTO (non-fatal)."
      );
    }

    // ---- Re-bag the UPDATED DTO; replace ctx["bag"] ------------------------
    const dtos: IDto[] = [existing as unknown as IDto];
    const { bag: updatedBag } = BagBuilder.fromDtos(dtos, {
      requestId: requestId ?? this.ctx.get("requestId") ?? "unknown",
      limit: 1,
      cursor: null,
      total: 1,
    });

    (updatedBag as any)?.sealSingleton?.(); // harmless if not implemented

    this.ctx.set("bag", updatedBag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "execute_exit",
        handler: this.constructor.name,
        singleton: true,
        requestId,
      },
      "code.patch exit — existing DTO patched and re-bagged"
    );
  }
}
