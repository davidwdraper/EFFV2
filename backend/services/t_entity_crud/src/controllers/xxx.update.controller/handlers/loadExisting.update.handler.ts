// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/loadExisting.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 *
 * Purpose:
 * - Build DbReader<XxxDto> and load existing doc by canonical ctx["id"].
 * - Returns a **DtoBag** (0..1). For pipeline convenience, also surfaces the DTO
 *   as ctx["existing"] when exactly one item is present.
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :xxxId)
 * - "svcEnv": SvcEnvDto (required)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<XxxDto>        (always set; size 0 or 1 here)
 * - "existing": XxxDto           (only when bag has exactly 1 item)
 * - "dbReader": DbReader<XxxDto>
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";

export class LoadExistingUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "loadExisting.update enter");

    // --- Required id ---------------------------------------------------------
    const id = String(this.ctx.get("id") ?? "").trim();
    if (!id) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "MISSING_ID",
        message: "Path param :id is required.",
        hint: "PATCH /api/xxx/v1/<id> with JSON body of fields to update.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "missing_id" },
        "loadExisting.update exit"
      );
      return;
    }

    // --- Required context (svcEnv + dtoCtor) --------------------------------
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto missing. Ops: ControllerBase must seed 'svcEnv' from App.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "svcenv_missing" },
        "loadExisting.update exit"
      );
      return;
    }

    const dtoCtor = this.ctx.get<any>("update.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromJson !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DTO_CTOR_MISSING",
        message:
          "DTO constructor missing in ctx as 'update.dtoCtor' or missing static fromJson().",
      });
      this.log.debug(
        { event: "execute_exit", reason: "dtoCtor_missing" },
        "loadExisting.update exit"
      );
      return;
    }

    // --- Reader + fetch as BAG ----------------------------------------------
    const validateReads =
      this.ctx.get<boolean>("update.validateReads") ?? false;
    const reader = new DbReader<any>({ dtoCtor, svcEnv, validateReads });
    this.ctx.set("dbReader", reader);

    // readOneBagById expects an object: { id }
    const bag = await reader.readOneBagById({ id });
    this.ctx.set("bag", bag as DtoBag<IDto>);

    const items = Array.from(bag.items());
    if (items.length === 0) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 404);
      this.ctx.set("error", {
        code: "NOT_FOUND",
        message: "No document found for supplied :id.",
        hint: "Confirm the id from create/read response; ensure same collection.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "not_found", id },
        "loadExisting.update exit"
      );
      return;
    }
    if (items.length > 1) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MULTIPLE_MATCHES",
        message:
          "Invariant breach: multiple records matched primary key lookup.",
        hint: "Check unique index on _id and upstream normalization.",
      });
      this.log.warn(
        { event: "pk_multiple_matches", id, count: items.length },
        "expected singleton bag for id read"
      );
      return;
    }

    // Singleton happy path: expose the DTO for downstream patch handler
    this.ctx.set("existing", items);
    this.ctx.set("handlerStatus", "ok");
    this.log.debug({ event: "execute_exit", id }, "loadExisting.update exit");
  }
}
