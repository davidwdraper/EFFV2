// backend/services/t_entity_crud/src/controllers/xxx.create.controller/handlers/dbWrite.create.handler.ts
/**
 * Docs:
 * - ADR-0040/41/42/43/44
 *
 * Purpose:
 * - Execute DB write for PUT /api/xxx/v1/create.
 * - On duplicate key:
 *    - **Log at WARN** (data issue)
 *    - **Return HTTP 409** Conflict (operation failed)
 *
 * Instrumentation:
 * - DEBUG create_target { collection }
 * - DEBUG insert_one_complete { id, collection }
 * - WARN  duplicate_key { index, key, detail }
 */

import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbManagerHandler } from "@nv/shared/http/DbManagerHandler";
import { DbWriter } from "@nv/shared/dto/persistence/DbWriter";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { DuplicateKeyError } from "@nv/shared/dto/persistence/adapters/mongo/dupeKeyError";

export class DbWriteCreateHandler extends DbManagerHandler<
  DbWriter<XxxDto>,
  { id: string }
> {
  constructor(ctx: HandlerContext) {
    super(
      ctx,
      // ctx key where the writer is stored by DtoToDbCreateHandler
      "dbWriter",
      // writer action: perform the write
      (w) => w.write(),
      // success: capture id, set result, and emit debug logs
      (c, { id }) => {
        // Resolve logger & collection for consistent diagnostics
        const log = (c.get<any>("App") as any)?.log ?? console;
        const writer = c.get<DbWriter<XxxDto>>("dbWriter");
        const collection = (writer as any)?.collectionName ?? "unknown";

        // DEBUG: show where we wrote and what id Mongo assigned
        log.debug?.(
          { event: "create_target", collection },
          "create will write to collection"
        );
        log.debug?.(
          { event: "insert_one_complete", id, collection },
          "create complete"
        );

        // Surface result to the finalize step (controller stays orchestration-only)
        c.set("insertedId", id);
        c.set("result", { ok: true, id });
      },
      // Duplicate policy: warn log + 409 error response
      (c, err: DuplicateKeyError) => {
        // 1) Record a warning for operators (and keep it in the finalized payload for visibility)
        const warning = {
          code: "DUPLICATE",
          message: "Unique constraint violation (duplicate key).",
          detail: err.message,
          index: err.index,
          key: err.key,
        };
        c.set("warnings", [...(c.get<any[]>("warnings") ?? []), warning]);

        // 2) Emit WARN-level log (data-related issue)
        const log = (c.get<any>("App") as any)?.log ?? console;
        log.warn?.(
          {
            event: "duplicate_key",
            index: err.index,
            key: err.key,
            detail: err.message,
          },
          "dbWrite.create duplicate — returning 409"
        );

        // 3) Fail the operation with a 409 Conflict (operation did not succeed)
        c.set("status", 409);
        c.set("handlerStatus", "error"); // ControllerBase → problem+json
        c.set("error", {
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
      }
    );
  }
}
