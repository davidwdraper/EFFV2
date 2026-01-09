// backend/services/prompt/src/controllers/prompt.update.controller/handlers/code.patch.ts
/**
 * Docs:
 * - ADR-0041/0042 (Handlers, Context Bus)
 * - ADR-0048 (All reads return DtoBag)
 * - ADR-0050 (Wire Bag Envelope; singleton inbound; canonical id="_id")
 * - ADR-0053 (Bag Purity; bag-centric processing)
 *
 * Purpose:
 * - Patch the **existing** entity (from ctx["existingBag"]) using the client **patch**
 *   payload (from ctx["bag"]) — both are **singleton DtoBags<PromptDto>**.
 * - Output a **singleton DtoBag<PromptDto>** with the UPDATED DTO and replace ctx["bag"] with it.
 *
 * Inputs (ctx):
 * - "existingBag": DtoBag<PromptDto>   (singleton; from DbReadExistingHandler)
 * - "bag": DtoBag<PromptDto>           (singleton; from hydrate/BagPopulate handler — the patch)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<PromptDto>           (REPLACED with updated singleton bag)
 * - "handlerStatus": "ok" | "error"
 * - "response.status": number          (on error)
 * - "response.body": RFC7807 problem   (on error)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { PromptDto } from "@nv/shared/dto/db.prompt.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import type { IDto } from "@nv/shared/dto/IDto";
import type { IDtoRegistry } from "@nv/shared/registry/DtoRegistry";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

export class CodePatchHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerJsonBase) {
    super(ctx, controller);
  }

  public handlerName(): string {
    return "code.prompt.patch";
  }

  public handlerPurpose(): string {
    return 'Patch existing PromptDto with a singleton patch bag and replace ctx["bag"] with the updated singleton.';
  }

  protected async execute(): Promise<void> {
    const requestIdRaw = this.ctx.get("requestId");
    const requestId =
      typeof requestIdRaw === "string" && requestIdRaw.trim() !== ""
        ? requestIdRaw
        : "unknown";

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.handlerName(),
        requestId,
      },
      "CodePatchHandler.execute enter"
    );

    const existingBag = this.ctx.get<DtoBag<PromptDto>>("existingBag");
    const patchBag = this.ctx.get<DtoBag<PromptDto>>("bag");

    if (!existingBag || !patchBag) {
      const status = 500;
      const problem = {
        type: "about:blank",
        title: "Internal Error",
        detail:
          "Required bags not found on context. Ops: ensure DbReadExistingHandler set 'existingBag' and hydrate/BagPopulate handler set 'bag'.",
        status,
        code: "BAGS_MISSING",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.error(
        {
          event: "bags_missing",
          handler: this.handlerName(),
          hasExistingBag: !!existingBag,
          hasPatchBag: !!patchBag,
          requestId,
        },
        "CodePatchHandler.execute missing required bags on context"
      );
      return;
    }

    const existingItems = Array.from(existingBag.items());
    const patchItems = Array.from(patchBag.items());

    if (existingItems.length !== 1) {
      const notFound = existingItems.length === 0;
      const status = notFound ? 404 : 500;
      const problem = {
        type: "about:blank",
        title: notFound ? "Not Found" : "Internal Error",
        detail: notFound
          ? "No existing record found for supplied id."
          : "Invariant breach: multiple records matched primary key lookup.",
        status,
        code: notFound ? "NOT_FOUND" : "MULTIPLE_MATCHES",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.warn(
        {
          event: "existing_bag_not_singleton",
          handler: this.handlerName(),
          count: existingItems.length,
          requestId,
        },
        "CodePatchHandler.execute expected singleton existing bag"
      );
      return;
    }

    if (patchItems.length !== 1) {
      const status = 400;
      const tooFew = patchItems.length === 0;
      const problem = {
        type: "about:blank",
        title: "Bad Request",
        detail: tooFew
          ? "Update requires exactly one patch item; received 0."
          : "Update requires exactly one patch item; received more than 1.",
        status,
        code: tooFew ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.warn(
        {
          event: "patch_bag_not_singleton",
          handler: this.handlerName(),
          count: patchItems.length,
          requestId,
        },
        "CodePatchHandler.execute expected singleton patch bag"
      );
      return;
    }

    const existing = existingItems[0];
    const patchDto = patchItems[0];

    if (!(existing instanceof PromptDto) || !(patchDto instanceof PromptDto)) {
      const status = 400;
      const problem = {
        type: "about:blank",
        title: "Bad Request",
        detail:
          "DtoBag type mismatch: expected PromptDto for both existing and patch items.",
        status,
        code: "TYPE_MISMATCH",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.error(
        {
          event: "type_mismatch",
          handler: this.handlerName(),
          existingType: (existing as any)?.constructor?.name,
          patchType: (patchDto as any)?.constructor?.name,
          requestId,
        },
        "CodePatchHandler.execute DtoBag type mismatch"
      );
      return;
    }

    try {
      const patchJson = patchDto.toBody() as Record<string, unknown>;
      existing.patchFrom(patchJson);

      this.log.debug(
        {
          event: "patched_dto",
          handler: this.handlerName(),
          requestId,
        },
        "CodePatchHandler.execute applied patch via PromptDto.patchFrom"
      );
    } catch (rawError: any) {
      const status = 400;
      const problem = {
        type: "about:blank",
        title: "Bad Request",
        detail: (rawError as Error).message,
        status,
        code: "DTO_VALIDATION_FAILED",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", {
        problem,
        rawError,
      });

      this.log.error(
        {
          event: "dto_validation_failed",
          handler: this.handlerName(),
          requestId,
          rawError,
        },
        "CodePatchHandler.execute DTO validation failed during patch"
      );
      return;
    }

    // Re-assert instance collection (best-effort; DbWriter will enforce).
    try {
      const dtoType = this.ctx.get<string>("dtoKey");
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
    } catch (rawError: any) {
      this.log.warn(
        {
          event: "collection_reassert_failed",
          handler: this.handlerName(),
          requestId,
          rawError,
        },
        "CodePatchHandler.execute failed to reassert collection name; continuing"
      );
    }

    const dtos: IDto[] = [existing as unknown as IDto];
    const { bag: updatedBag } = BagBuilder.fromDtos(dtos, {
      requestId,
      limit: 1,
      cursor: null,
      total: 1,
    });
    (updatedBag as any)?.sealSingleton?.();

    this.ctx.set("bag", updatedBag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "execute_exit",
        handler: this.handlerName(),
        singleton: true,
        requestId,
      },
      "CodePatchHandler.execute exit (success; existing DTO patched and re-bagged)"
    );
  }
}
