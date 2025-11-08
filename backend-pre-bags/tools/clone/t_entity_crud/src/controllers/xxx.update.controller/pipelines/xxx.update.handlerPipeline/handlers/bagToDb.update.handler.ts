// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/bagToDb.update.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0048 (Revised — all reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; no naked DTOs on the bus)
 *
 * Purpose:
 * - Consume the UPDATED **singleton DtoBag** from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<XxxDto>   (UPDATED singleton; from ApplyPatchUpdateHandler)
 *
 * Outputs (ctx):
 * - "result": { ok: true, id }
 * - "status": 200
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/DbWriter";

export class BagToDbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "bagToDb.update enter");

    // --- Required context ----------------------------------------------------
    const bag = this.ctx.get<DtoBag<XxxDto>>("bag");
    if (!bag) {
      return this._badRequest(
        "BAG_MISSING",
        "Updated DtoBag missing. Ensure ApplyPatchUpdateHandler ran."
      );
    }

    const items = Array.from(bag.items());
    if (items.length !== 1) {
      return this._badRequest(
        items.length === 0 ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
        items.length === 0
          ? "Update requires exactly one item; received 0."
          : "Update requires exactly one item; received more than 1."
      );
    }

    // Pull SvcEnv directly from Controller/App (no ctx plumbing)
    const svcEnv = this.controller.getSvcEnv();

    // --- Writer (bag-centric) -----------------------------------------------
    const writer = new DbWriter<XxxDto>({ bag, svcEnv });

    try {
      const { collectionName } = (await writer.targetInfo?.()) ?? {
        collectionName: "<unknown>",
      };
      this.log.debug(
        { event: "update_target", collection: collectionName },
        "update will write to collection"
      );

      // Bag-centric update; writer determines the id from the DTO inside the bag.
      const { id } = await writer.update();

      this.log.debug(
        { event: "update_complete", id, collection: collectionName },
        "update complete"
      );

      this.ctx.set("updatedId", id);
      this.ctx.set("result", { ok: true, id });
      this.ctx.set("status", 200);
      this.ctx.set("handlerStatus", "ok");
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        const keyObj = (err as DuplicateKeyError).key ?? {};
        const keyPath = Object.keys(keyObj).join(",");

        const warning = {
          code: "DUPLICATE",
          message: "Unique constraint violation (duplicate key).",
          detail: (err as Error).message,
          index: (err as DuplicateKeyError).index,
          key: (err as DuplicateKeyError).key,
        };
        this.ctx.set("warnings", [
          ...(this.ctx.get<any[]>("warnings") ?? []),
          warning,
        ]);

        this.log.warn(
          {
            event: "duplicate_key",
            index: (err as DuplicateKeyError).index,
            key: (err as DuplicateKeyError).key,
            detail: (err as Error).message,
          },
          "update duplicate — returning 409"
        );

        this.ctx.set("status", 409);
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("error", {
          code: "DUPLICATE",
          title: "Conflict",
          detail: (err as Error).message,
          issues: keyPath
            ? [
                {
                  path: keyPath,
                  code: "unique",
                  message: "duplicate value",
                },
              ]
            : undefined,
        });
      } else {
        this.log.error(
          {
            event: "db_update_failed",
            error: (err as Error).message,
          },
          "update failed unexpectedly"
        );
        throw err;
      }
    }

    this.log.debug({ event: "execute_exit" }, "bagToDb.update exit");
  }

  private _badRequest(code: string, detail: string): void {
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("status", 400);
    this.ctx.set("error", { code, title: "Bad Request", detail });
  }
}
