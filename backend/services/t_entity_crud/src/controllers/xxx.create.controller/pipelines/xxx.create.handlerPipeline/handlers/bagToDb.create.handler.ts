// backend/services/t_entity_crud/src/controllers/xxx.create.controller/handlers/bagToDb.create.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Hydration & Failure Propagation)
 * - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - For PUT /api/xxx/v1/:
 *   • Read bag (seeded by BagPopulateGetHandler) and enforce exactly one item.
 *   • Resolve Mongo connection info from svc env DTO.
 *   • Build a DbWriter({ bag, mongoUri, mongoDb }) and execute write().
 *   • Map duplicate-key → HTTP 409 with WARN.
 *
 * Inputs (ctx):
 * - "bag": DtoBag<IDto>       (ALWAYS set by BagPopulateGetHandler)
 *
 * Outputs (ctx):
 * - "result": { ok: true, id }  on success
 * - "status": 200               on success
 * - On error: "status", "error", "handlerStatus" set appropriately
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/DbWriter";

export class BagToDbCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "BagToDbCreateHandler enter");

    // 1) Inputs from pipeline
    const bag = this.ctx.get<DtoBag<IDto>>("bag");
    if (!bag) {
      this._badRequest(
        "BAG_MISSING",
        'Missing items. Provide JSON body { items:[{ type:"xxx", ... }] }.'
      );
      return;
    }

    // Framework rule: exactly one item for create (no singleton DTO leaks).
    const items = [...bag.items()];
    if (items.length !== 1) {
      this._badRequest(
        items.length === 0 ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
        items.length === 0
          ? "Create requires exactly one item; received 0."
          : "Create requires exactly one item; received more than 1."
      );
      return;
    }

    // 2) Pull svc env-config via ControllerBase.getSvcEnv() (ADR-0044)
    const svcEnvAny: any = this.controller.getSvcEnv();

    // Support both shapes:
    //   • { vars: { NV_MONGO_URI, NV_MONGO_DB, ... } }
    //   • { NV_MONGO_URI, NV_MONGO_DB, ... } (flattened)
    const vars = svcEnvAny?.vars ?? svcEnvAny ?? {};
    const mongoUri: string | undefined =
      vars.NV_MONGO_URI ?? vars["NV_MONGO_URI"];
    const mongoDb: string | undefined = vars.NV_MONGO_DB ?? vars["NV_MONGO_DB"];

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
      });

      this.log.error(
        {
          event: "mongo_env_missing",
          hasSvcEnv: !!svcEnvAny,
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
        },
        "create aborted — Mongo env config missing"
      );

      this.log.debug({ event: "execute_exit" }, "BagToDbCreateHandler exit");
      return;
    }

    // 3) Build writer with **bag**, not a naked DTO (bags across all interfaces)
    const baseBag = bag as unknown as DtoBag<DtoBase>;
    const writer = new DbWriter<DtoBase>({
      bag: baseBag,
      mongoUri,
      mongoDb,
      log: this.log,
    });

    try {
      const { collectionName } = await writer.targetInfo();
      this.log.debug(
        { event: "create_target", collection: collectionName },
        "create will write to collection"
      );

      // 4) Execute write
      const { id } = await writer.write();
      this.log.debug(
        { event: "insert_one_complete", id, collection: collectionName },
        "create complete"
      );

      this.ctx.set("insertedId", id);
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
          },
          "create duplicate — returning 409"
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
            event: "db_write_failed",
            error: (err as Error).message,
          },
          "create failed unexpectedly"
        );
        throw err;
      }
    }

    this.log.debug({ event: "execute_exit" }, "BagToDbCreateHandler exit");
  }

  private _badRequest(code: string, detail: string): void {
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("status", 400);
    this.ctx.set("error", { code, title: "Bad Request", detail });
    this.log.warn({ event: "bad_request", code }, "BagToDbCreateHandler");
  }
}
