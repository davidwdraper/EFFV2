// backend/services/t_entity_crud/src/controllers/xxx.create.controller/handlers/bagToDb.create.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Hydration & Failure Propagation)
 * - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Prepare a DbWriter from a **DtoBag** item and SvcEnvDto.
 * - Stash the writer into HandlerContext as "dbWriter". **No write here.**
 *
 * Inputs (ctx):
 * - "bag": DtoBag<IDto> (hydrated by BagPopulateGetHandler; upstream should enforce singleton)
 * - "svcEnv": SvcEnvDto (seeded by ControllerBase from App)
 *
 * Outputs (ctx):
 * - "dbWriter": DbWriter<BaseDto>
 *
 * Notes:
 * - This handler assumes the create pipeline enforces a single-item bag.
 *   We add a light guard; if size != 1, fail fast (400).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import type { BaseDto } from "@nv/shared/dto/DtoBase";
import { DbWriter } from "@nv/shared/dto/persistence/DbWriter";

export class DtoToDbCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "dtoToDb (create) enter");

    // 1) Pull the hydrated bag from context
    const bag = this.ctx.get<DtoBag<IDto>>("bag");
    if (!bag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAG_MISSING",
        title: "Bad Request",
        detail:
          'Missing items. Provide JSON body { items:[{ type:"xxx", ... }] }.',
      });
      this.log.debug({ event: "bag_missing" }, "DtoBag not found on context");
      return;
    }

    // Guard: enforce exactly one item (create is singleton)
    const it = bag.items();
    const first = it.next();
    if (first.done === true) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "EMPTY_ITEMS",
        title: "Bad Request",
        detail: "Create requires exactly one item; received 0.",
      });
      this.log.debug({ event: "empty_items" }, "bag.items length = 0");
      return;
    }
    const second = it.next();
    if (second.done !== true) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "TOO_MANY_ITEMS",
        title: "Bad Request",
        detail: "Create requires exactly one item; received more than 1.",
      });
      this.log.debug({ event: "too_many_items" }, "bag.items length > 1");
      return;
    }

    const dto = first.value as unknown as BaseDto;

    // 2) SvcEnv is the single source of DB connectivity (no factories/globals)
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        title: "Internal Error",
        detail:
          "SvcEnvDto not found in context. Ops: ControllerBase must seed 'svcEnv' from App.",
      });
      this.log.debug({ event: "svcenv_missing" }, "SvcEnv missing");
      return;
    }

    // 3) Construct writer with DTO + SvcEnv (no write() here)
    const writer = new DbWriter<BaseDto>({ dto, svcEnv });
    this.ctx.set("dbWriter", writer);
    this.ctx.set("handlerStatus", "ok");

    // Instrumentation: show target collection if available (best-effort)
    try {
      const { collectionName } = await writer.targetInfo();
      this.log.debug(
        { event: "writer_ready", collection: collectionName },
        "DbWriter constructed & stored as 'dbWriter'"
      );
    } catch {
      this.log.debug(
        { event: "writer_ready_no_introspection" },
        "DbWriter constructed (target introspection unavailable)"
      );
    }

    this.log.debug({ event: "execute_exit" }, "dtoToDb (create) exit");
  }
}
