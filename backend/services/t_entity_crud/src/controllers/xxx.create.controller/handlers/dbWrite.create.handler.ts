// backend/services/t_entity_crud/src/controllers/xxx.create.controller/handlers/dbWrite.create.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus, KISS)
 * - ADR-0043 (Hydration & Failure Propagation; finalize())
 *
 * Purpose:
 * - Execute the actual DB write for PUT /api/xxx/v1/create.
 * - Reads a pre-constructed DbWriter<XxxDto> from HandlerContext and calls write().
 * - On success, stashes the insert id in context under "insertedId" and "result".
 *
 * Inputs (ctx):
 * - "dbWriter": DbWriter<XxxDto> (created by dtoToDb.create.handler)
 *
 * Outputs (ctx):
 * - "insertedId": string
 * - "result": { ok: true, id: string }
 * - "handlerStatus": "ok" | "error"
 *
 * Failure semantics:
 * - If "dbWriter" missing → 500 with Ops guidance.
 * - If write() throws → 500 with error code DB_WRITE_FAILED and actionable hints.
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import { DbWriter } from "@nv/shared/dto/persistence/DbWriter";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

export class DbWriteCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "dbWrite.create handler enter");

    // Retrieve the prepared writer
    const writer = this.ctx.get<DbWriter<XxxDto>>("dbWriter");
    if (!writer) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DB_WRITER_MISSING",
        message:
          "DbWriter not found in context. Ops: ensure dtoToDb.create.handler runs before dbWrite.create.handler.",
        hint: "Verify handler ordering in xxx.create.controller.ts. dtoFromJson → dtoToDb → dbWrite is the required sequence.",
      });
      this.log.debug(
        { event: "execute_error", reason: "writer_missing" },
        "DbWriter missing from context"
      );
      return;
    }

    try {
      const { id } = await writer.write();

      // Persist outcome into context for finalize() and/or downstream shapers
      this.ctx.set("insertedId", id);
      this.ctx.set("result", { ok: true, id });
      this.ctx.set("handlerStatus", "ok");

      this.log.debug({ event: "write_ok", id }, "dbWrite.create succeeded");
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DB_WRITE_FAILED",
        message:
          "Database write failed for XxxDto. Ops: see detail; verify Mongo connectivity, credentials, and collection write concerns.",
        detail: msg,
        hint: "Check svcEnv Mongo URL/DB/collection, user privileges (insert), and index conflicts (e.g., unique violations). Use x-request-id to correlate logs.",
      });

      this.log.debug(
        { event: "execute_error", error: msg },
        "dbWrite.create failed"
      );
      return;
    }

    this.log.debug({ event: "execute_exit" }, "dbWrite.create handler exit");
  }
}
