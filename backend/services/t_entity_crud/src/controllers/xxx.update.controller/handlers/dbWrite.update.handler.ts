// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/dbWrite.update.handler.ts
/**
 * Docs:
 * - ADR-0040/41/42/43/44
 *
 * Purpose:
 * - Execute DB update for PATCH /api/xxx/v1/:xxxId.
 * - Mirrors dbWrite.create.handler.ts behavior 1:1.
 * - On duplicate key:
 *    - **Log at WARN** (data issue)
 *    - **Return HTTP 409** Conflict (operation failed)
 */

import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbManagerHandler } from "@nv/shared/http/DbManagerHandler";
import { DbWriter } from "@nv/shared/dto/persistence/DbWriter";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { DuplicateKeyError } from "@nv/shared/dto/persistence/adapters/mongo/dupeKeyError";

export class DbWriteUpdateHandler extends DbManagerHandler<
  DbWriter<XxxDto>,
  { id: string }
> {
  constructor(ctx: HandlerContext) {
    super(
      ctx,
      "dbWriter",
      // Operation: mirror create, but call update()
      (w) => w.update(),
      // Success mapper: mirror create’s envelope
      (c, { id }) => {
        c.set("updatedId", id);
        c.set("result", { ok: true, id });
      },
      // Duplicate policy: warn log + 409 error response (identical shape)
      (c, err: DuplicateKeyError) => {
        const warning = {
          code: "DUPLICATE",
          message: "Unique constraint violation (duplicate key).",
          detail: err.message,
          index: err.index,
          key: err.key,
        };
        c.set("warnings", [...(c.get<any[]>("warnings") ?? []), warning]);

        const log = (c.get<any>("App") as any)?.log ?? console;
        log.warn?.(
          {
            event: "duplicate_key",
            index: err.index,
            key: err.key,
            detail: err.message,
          },
          "dbWrite.update duplicate — returning 409"
        );

        c.set("status", 409);
        c.set("handlerStatus", "error");
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
