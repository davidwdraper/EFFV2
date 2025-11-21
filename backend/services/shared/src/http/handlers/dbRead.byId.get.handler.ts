// backend/services/shared/src/http/handlers/dbRead.byId.get.handler.ts
/**
 * Shared GET-by-id handler:
 *   GET /:dtoType/read/:id
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import { DbReader } from "../../dto/persistence/DbReader";
import type { DtoBag } from "../../dto/DtoBag";
import type { DtoBase } from "../../dto/DtoBase";
import { isValidUuidV4 } from "../../utils/uuid";

type DtoCtorWithCollection<T> = {
  fromJson: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string;
  name?: string;
};

export class DbReadByIdGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_start" }, "dbRead.byId.enter");

    const params: any = this.ctx.get("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.ctx.get<string>("dtoType") ?? "";

    if (!dtoType) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':dtoType'.",
        hint: "Call GET /api/:slug/v:version/:dtoType/read/:id",
      });
      this.log.warn(
        { event: "bad_request", reason: "no_dtoType" },
        "dbRead.byId — missing :dtoType"
      );
      return;
    }

    if (!rawId) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':id'.",
        hint: "Call GET /api/:slug/v:version/:dtoType/read/:id",
      });
      this.log.warn(
        { event: "bad_request", reason: "no_id" },
        "dbRead.byId — missing :id"
      );
      return;
    }

    if (!isValidUuidV4(rawId)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST_ID_FORMAT",
        title: "Bad Request",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        hint: "Use a UUIDv4 for the canonical DTO id.",
      });
      this.log.warn(
        { event: "bad_request", reason: "invalid_id_format", id: rawId },
        "dbRead.byId — invalid id format"
      );
      return;
    }

    const registry = this.controller.getDtoRegistry?.();
    if (!registry || typeof registry.resolveCtorByType !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "REGISTRY_MISSING",
        title: "Internal Error",
        detail:
          "DtoRegistry missing or incomplete; cannot resolve DTO constructor.",
        hint: "AppBase must expose a DtoRegistry; ControllerBase wires it via getDtoRegistry().",
      });
      this.log.error(
        {
          event: "registry_missing",
          dtoType,
          hasRegistry: !!registry,
        },
        "dbRead.byId — registry missing for ctor resolution"
      );
      return;
    }

    let dtoCtor: DtoCtorWithCollection<DtoBase>;
    try {
      dtoCtor = registry.resolveCtorByType(
        dtoType
      ) as unknown as DtoCtorWithCollection<DtoBase>;
    } catch (e: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "UNKNOWN_DTO_TYPE",
        title: "Bad Request",
        detail:
          e?.message ??
          `Unable to resolve DTO constructor for dtoType '${dtoType}'.`,
        hint: "Verify the DtoRegistry contains this dtoType.",
      });
      this.log.warn(
        {
          event: "dto_type_resolve_failed",
          dtoType,
          err: e?.message,
        },
        "dbRead.byId — failed to resolve dtoCtor"
      );
      return;
    }

    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          handler: this.constructor.name,
        },
        "dbRead.byId aborted — Mongo env config missing"
      );
      return;
    }

    try {
      const reader = new DbReader<DtoBase>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads: false,
      });

      const tgt = await reader.targetInfo();
      this.log.debug(
        {
          event: "read_target",
          collection: tgt.collectionName,
          dtoType,
          id: rawId,
        },
        "dbRead.byId — target collection"
      );

      const bag: DtoBag<DtoBase> = await reader.readOneBagById({ id: rawId });

      this.ctx.set("bag", bag);

      const size = bag.size();

      if (size === 0) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("status", 404);
        this.ctx.set("error", {
          code: "NOT_FOUND",
          title: "Not Found",
          detail: `No document matched id='${rawId}'`,
          hint: "Verify the id or re-read after writing.",
        });
        this.log.warn(
          {
            event: "read_not_found",
            id: rawId,
            dtoType,
            collectionName: tgt.collectionName,
          },
          "dbRead.byId — not found"
        );
        return;
      }

      if (size !== 1) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("status", 500);
        this.ctx.set("error", {
          code: "READ_INVARIANT_VIOLATION",
          title: "Internal Error",
          detail: `Expected exactly 1 document for id='${rawId}', found ${size}.`,
          hint: "Check for duplicate ids or index issues on the underlying collection.",
        });
        this.log.error(
          {
            event: "read_invariant_violation",
            id: rawId,
            dtoType,
            collectionName: tgt.collectionName,
            size,
          },
          "dbRead.byId — invariant violated (size != 1)"
        );
        return;
      }

      const dto = bag.getSingleton();
      const json = dto.toJson();

      this.ctx.set("result", {
        ok: true,
        items: [json],
      });

      this.ctx.set("handlerStatus", "ok");
      this.log.info(
        {
          event: "read_ok",
          id: (json as any)._id,
          dtoType,
          collectionName: tgt.collectionName,
        },
        "dbRead.byId — read succeeded"
      );
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DB_READ_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
        hint: "Check Mongo connectivity, collection indexes, and env-service configuration.",
      });
      this.log.error(
        { event: "read_error", err: err?.message },
        "dbRead.byId — read failed"
      );
    } finally {
      this.log.debug({ event: "execute_end" }, "dbRead.byId.exit");
    }
  }
}
