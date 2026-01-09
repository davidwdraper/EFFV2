// backend/services/shared/src/http/handlers/code.patch.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; bag-centric processing
 * - ADRs:
 *   - ADR-0040/0041/0042/0043
 *   - ADR-0048 (All reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; bag-centric processing)
 *   - ADR-0102 (Registry sole DTO creation authority)
 *   - ADR-0103 (DTO key naming)
 *
 * Purpose:
 * - Patch an existing singleton bag using a singleton patch bag.
 * - Replace ctx["bag"] with UPDATED singleton bag.
 *
 * Notes:
 * - No legacy registry calls.
 * - No "type → collection" helpers.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { DtoBag } from "../../dto/DtoBag";
import type { DtoBase } from "../../dto/DtoBase";
import { BagBuilder } from "../../dto/wire/BagBuilder";
import type { IDtoRegistry } from "../../registry/IDtoRegistry";
import type { IDto } from "../../dto/IDto";

export class CodePatchHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Patch an existing singleton bag using a singleton patch bag and re-bag the updated DTO onto ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const existingBag = this.ctx.get<DtoBag<DtoBase>>("existingBag");
    const patchBag = this.ctx.get<DtoBag<DtoBase>>("bag");

    if (!existingBag || !patchBag) {
      this.failWithError({
        httpStatus: 500,
        title: "bags_missing",
        detail:
          "Required bags not found on context. Ops: ensure prior handlers set 'existingBag' and 'bag' before code.patch.",
        stage: "config.bags",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasExistingBag: !!existingBag, hasPatchBag: !!patchBag }],
        logMessage:
          "code.patch — required DtoBags missing from context (existingBag / bag).",
        logLevel: "error",
      });
      return;
    }

    const existingItems = Array.from(existingBag.items());
    const patchItems = Array.from(patchBag.items());

    if (existingItems.length !== 1) {
      const size = existingItems.length;
      this.failWithError({
        httpStatus: size === 0 ? 404 : 500,
        title: "existing_bag_singleton_violation",
        detail:
          size === 0
            ? "No existing record found for supplied id."
            : "Invariant breach: multiple records matched primary key lookup.",
        stage: "business.existingSingleton",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ size }],
        logMessage:
          "code.patch — existingBag must be a singleton for patch operation.",
        logLevel: size === 0 ? "warn" : "error",
      });
      return;
    }

    if (patchItems.length !== 1) {
      const size = patchItems.length;
      this.failWithError({
        httpStatus: 400,
        title: "patch_bag_singleton_violation",
        detail:
          size === 0
            ? "Update requires exactly one patch item; received 0."
            : `Update requires exactly one patch item; received ${size}.`,
        stage: "business.patchSingleton",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ size }],
        logMessage:
          "code.patch — patch bag must be a singleton for update operation.",
        logLevel: "warn",
      });
      return;
    }

    const existing = existingItems[0] as any;
    const patchDto = patchItems[0] as any;

    const hasPatchShape =
      typeof existing?.patchFrom === "function" &&
      typeof patchDto?.toBody === "function";

    if (!hasPatchShape) {
      this.failWithError({
        httpStatus: 500,
        title: "dto_patch_capability_missing",
        detail:
          "DtoBag items do not expose expected patchFrom/toBody methods. Dev: ensure this DTO supports patch semantics.",
        stage: "business.typeGuard",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            existingType: existing?.constructor?.name,
            patchType: patchDto?.constructor?.name,
            hasExistingPatchFrom: typeof existing?.patchFrom === "function",
            hasPatchDtoToBody: typeof patchDto?.toBody === "function",
          },
        ],
        logMessage: "code.patch — DTOs do not support patchFrom/toBody.",
        logLevel: "error",
      });
      return;
    }

    try {
      const patchJson = patchDto.toBody() as Record<string, unknown>;
      existing.patchFrom(patchJson);
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "dto_validation_failed",
        detail:
          (err as Error)?.message ??
          "DTO validation failed while applying patch payload.",
        stage: "business.patchApply",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            existingType: existing?.constructor?.name,
            patchType: patchDto?.constructor?.name,
          },
        ],
        rawError: err,
        logMessage:
          "code.patch — DTO patchFrom() threw during patch application.",
        logLevel: "warn",
      });
      return;
    }

    // Re-assert collection name if missing (defensive; should already be present).
    try {
      const dtoKey = this.ctx.get<string>("dtoKey"); // expected: ADR-0103 key, e.g. "db.user.dto"
      if (dtoKey && typeof this.controller?.getDtoRegistry === "function") {
        const reg: IDtoRegistry = this.controller.getDtoRegistry();
        const coll = reg.getCollectionName(dtoKey);

        if (
          !existing.getCollectionName?.() &&
          typeof existing.setCollectionName === "function"
        ) {
          existing.setCollectionName(coll);
        }
      }
    } catch {
      // non-fatal
    }

    const dtos: IDto[] = [existing as IDto];
    const { bag: updatedBag } = BagBuilder.fromDtos(dtos, {
      requestId: requestId ?? this.ctx.get("requestId") ?? "unknown",
      limit: 1,
      cursor: null,
      total: 1,
    });

    this.ctx.set("bag", updatedBag);
    this.ctx.set("handlerStatus", "ok");
  }
}
