// backend/services/shared/src/http/handlers/bag.toDb.create.handler.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; DTO-only edges
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0048 (Bag-centric reads/writes)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound for create)
 *
 * Purpose:
 * - Generic "bag → DB (create)" handler.
 * - Shared across services; final step in create/clone pipelines.
 *
 * Config (ctx):
 * - "bag.write.targetKey":       string ctx key to READ the bag from (default: "bag")
 * - "bag.write.ensureSingleton": boolean (default: true)
 *
 * Inputs (ctx):
 * - [targetKey]: DtoBag<DtoBase> (typically singleton)
 *
 * Outputs (ctx):
 * - [targetKey]: same bag instance (DTO ids populated by DbWriter)
 * - "handlerStatus": "ok" | "error"
 * - "response.status" / "response.body" on error
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
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
    this.log.debug({ event: "execute_enter" }, "bag.toDb.create enter");

    const targetKey =
      (this.ctx.get<string>("bag.write.targetKey") as string | undefined) ??
      "bag";
    const ensureSingleton =
      this.ctx.get<boolean>("bag.write.ensureSingleton") ?? true;

    const bag = this.ctx.get<DtoBag<DtoBase>>(targetKey);
    if (!bag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "BAG_WRITE_BAG_MISSING",
        title: "Internal Error",
        detail: `No DtoBag found on ctx['${targetKey}']. Dev: ensure upstream handlers populated this entry.`,
        requestId: this.ctx.get("requestId"),
      });
      this.log.debug(
        { event: "execute_exit", reason: "bag_missing", targetKey },
        "bag.toDb.create exit"
      );
      return;
    }

    if (ensureSingleton) {
      const size = Array.from(bag.items()).length;
      if (size !== 1) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 400);
        this.ctx.set("response.body", {
          code: size === 0 ? "BAG_WRITE_EMPTY" : "BAG_WRITE_TOO_MANY_ITEMS",
          title: "Bad Request",
          detail:
            size === 0
              ? "Create requires exactly one item in the bag; received 0."
              : `Create requires exactly one item in the bag; received ${size}.`,
          requestId: this.ctx.get("requestId"),
        });
        this.log.warn(
          { event: "bag_size_invalid", size, targetKey },
          "bag.toDb.create — singleton requirement failed"
        );
        return;
      }
    }

    const svcEnv = (this.controller as any).getSvcEnv?.();
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_DTO_MISSING",
        title: "Internal Error",
        detail:
          "EnvServiceDto missing from ControllerBase. Ops: ensure AppBase exposes svcEnv and controller extends ControllerBase correctly.",
        requestId: this.ctx.get("requestId"),
      });
      this.log.error(
        { event: "env_missing" },
        "bag.toDb.create — svcEnv missing"
      );
      return;
    }

    const svcEnvAny: any = svcEnv;
    const vars = svcEnvAny?.vars ?? svcEnvAny ?? {};
    const mongoUri: string | undefined =
      vars.NV_MONGO_URI ?? vars["NV_MONGO_URI"];
    const mongoDb: string | undefined = vars.NV_MONGO_DB ?? vars["NV_MONGO_DB"];

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service for NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
        requestId: this.ctx.get("requestId"),
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
        },
        "bag.toDb.create aborted — Mongo env config missing"
      );
      return;
    }

    const writer = new DbWriter<DtoBase>({
      bag: bag as DtoBag<DtoBase>,
      mongoUri,
      mongoDb,
      log: this.log,
    });

    try {
      const { id } = await writer.write();

      // DTO in the bag already has the id set; we just keep the bag on ctx.
      this.ctx.set(targetKey, bag);
      this.ctx.set("dbWriter.lastId", id);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        { event: "execute_exit", targetKey, id },
        "bag.toDb.create exit"
      );
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 409);
        this.ctx.set("response.body", {
          code: "DUPLICATE_KEY",
          title: "Conflict",
          detail: err.message,
          requestId: this.ctx.get("requestId"),
        });
        this.log.warn(
          { event: "duplicate_key", detail: err.message },
          "bag.toDb.create — duplicate key"
        );
        return;
      }

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "BAG_WRITE_FAILED",
        title: "Internal Error",
        detail: (err as Error)?.message ?? "DbWriter.write() failed.",
        requestId: this.ctx.get("requestId"),
      });
      this.log.error(
        { event: "write_failed", err: (err as Error)?.message },
        "bag.toDb.create — write failed"
      );
    }
  }
}
