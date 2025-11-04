// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/bagToDb.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041/42/43/44
 *
 * Purpose:
 * - Build a DbWriter from the UPDATED singleton bag and execute update().
 * - Duplicate key → WARN + HTTP 409 (matches create behavior).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<XxxDto>   (singleton, UPDATED; from ApplyPatchUpdateHandler)
 * - "dto": XxxDto           (convenience; if missing we’ll read from bag)
 * - "svcEnv": SvcEnvDto
 *
 * Outputs (ctx):
 * - "result": { ok: true, id }
 * - "status": 200
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/DbWriter";

export class BagToDbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "BagToDbUpdateHandler enter");

    const bag = this.ctx.get<DtoBag<XxxDto>>("bag");
    if (!bag) {
      return this._badRequest(
        "BAG_MISSING",
        "Updated DtoBag missing. Ensure ApplyPatchUpdateHandler ran."
      );
    }

    let dto = (this.ctx.get("dto") as XxxDto) ?? undefined;
    if (!dto) {
      const items = [...bag.items()];
      if (items.length !== 1) {
        return this._badRequest(
          items.length === 0 ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
          items.length === 0
            ? "Update requires exactly one item; received 0."
            : "Update requires exactly one item; received more than 1."
        );
      }
      dto = items[0];
    }

    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      return this._internalError(
        "SVCENV_MISSING",
        "SvcEnvDto not found in context. Ops: ControllerBase must seed 'svcEnv' from App."
      );
    }

    const writer = new DbWriter<XxxDto>({ dto, svcEnv });

    try {
      const { collectionName } = await writer.targetInfo();
      this.log.debug(
        { event: "update_target", collection: collectionName },
        "update will write to collection"
      );

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
        const warning = {
          code: "DUPLICATE",
          message: "Unique constraint violation (duplicate key).",
          detail: err.message,
          index: err.index,
          key: err.key,
        };
        this.ctx.set("warnings", [
          ...(this.ctx.get<any[]>("warnings") ?? []),
          warning,
        ]);

        this.log.warn(
          {
            event: "duplicate_key",
            index: err.index,
            key: err.key,
            detail: err.message,
            dto: (dto as any)?.constructor?.name ?? "DTO",
          },
          "update duplicate — returning 409"
        );

        this.ctx.set("status", 409);
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("error", {
          code: "DUPLICATE",
          title: "Conflict",
          detail: err.message,
          issues: err.key
            ? [
                {
                  path: Object.keys(err.key).join(","),
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
            dto: (dto as any)?.constructor?.name ?? "DTO",
          },
          "update failed unexpectedly"
        );
        throw err;
      }
    }

    this.log.debug({ event: "execute_exit" }, "BagToDbUpdateHandler exit");
  }

  private _badRequest(code: string, detail: string): void {
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("status", 400);
    this.ctx.set("error", { code, title: "Bad Request", detail });
  }

  private _internalError(code: string, detail: string): void {
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("status", 500);
    this.ctx.set("error", { code, title: "Internal Error", detail });
  }
}
