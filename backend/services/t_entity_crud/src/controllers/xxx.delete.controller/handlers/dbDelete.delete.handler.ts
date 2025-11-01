// backend/services/t_entity_crud/src/controllers/xxx.delete.controller/handlers/dbDelete.delete.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence; persistence adapters)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 * - ADR-0048 (DbReader/DbWriter contracts)
 *
 * Purpose:
 * - Delete a single document by DTO id for DELETE /delete/:xxxId
 * - Symmetric with read: resolve the SAME collection via DTO.dbCollectionName()
 *
 * Behavior:
 * - Success: 200 { ok: true, deleted: 1, id: "<id>" }
 * - Not found: 404 problem+json
 * - Bad input: 400 problem+json
 * - Unexpected: 500 problem+json
 *
 * Invariants:
 * - Handlers speak DTO-space ids (xxxId:string). Mongo details are hidden behind adapter helpers.
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { coerceForMongoQuery } from "@nv/shared/dto/persistence/adapters/mongo/queryHelper";
import { MongoClient, Db, Collection, ObjectId } from "mongodb";

let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;

/**
 * Resolve the explicit collection used by the DTO (mirrors DbWriter logic).
 * We intentionally avoid any “default collection” — DTO is the source of truth.
 */
async function getExplicitCollectionFromDtoCtor(
  svcEnv: SvcEnvDto,
  dtoCtor: { dbCollectionName: () => string; name?: string }
): Promise<Collection> {
  const uri = svcEnv.getEnvVar("NV_MONGO_URI");
  const dbName = svcEnv.getEnvVar("NV_MONGO_DB");
  const collectionName = dtoCtor.dbCollectionName();

  if (!uri || !dbName || !collectionName?.trim()) {
    throw new Error(
      `DBDELETE_MISCONFIG: NV_MONGO_URI/NV_MONGO_DB/collectionName required. DTO=${
        dtoCtor.name ?? "<anon>"
      }.`
    );
  }

  if (!_client) {
    _client = new MongoClient(uri);
    await _client.connect();
    _db = _client.db(dbName);
    _dbNamePinned = dbName;
  } else if (_dbNamePinned !== dbName) {
    throw new Error(
      `DBDELETE_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${dbName}".`
    );
  }

  return (_db as Db).collection(collectionName);
}

export class DbDeleteDeleteHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_start" }, "dbDelete.delete enter");

    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    // Controller should seed the DTO ctor for this route (mirrors read).
    // Prefer a delete-specific key; fall back to read's if controller shares it.
    const dtoCtor =
      this.ctx.get<any>("delete.dtoCtor") || this.ctx.get<any>("read.dtoCtor");

    if (!svcEnv || !dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DELETE_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required context missing (svcEnv or dtoCtor). Ops: verify ControllerBase.makeContext() and XxxDeleteController seeding.",
      });
      this.log.error(
        { event: "setup_missing", hasSvcEnv: !!svcEnv, hasDtoCtor: !!dtoCtor },
        "Delete setup missing"
      );
      return;
    }

    const params: any = this.ctx.get("params") ?? {};
    const idRaw =
      (typeof params.xxxId === "string" && params.xxxId.trim()) ||
      (typeof params.id === "string" && params.id.trim()) ||
      "";

    if (!idRaw) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':xxxId'.",
        hint: "Call DELETE /api/xxx/v1/delete/<xxxId>.",
      });
      this.log.warn(
        { event: "bad_request", reason: "no_id" },
        "Missing :xxxId"
      );
      return;
    }

    try {
      // Resolve the SAME collection used by the DTO (symmetry with read/write)
      const coll = await getExplicitCollectionFromDtoCtor(svcEnv, dtoCtor);

      // Coerce DTO id into Mongo filter (ObjectId if 24-hex; else as-is)
      const filter = coerceForMongoQuery({ _id: String(idRaw) }) as {
        _id: ObjectId;
      };

      // Instrument the resolved target for parity with read
      this.log.debug(
        {
          event: "delete_target",
          collection: coll.collectionName,
          pk: "xxxId",
        },
        "delete will query collection"
      );

      const r = await coll.deleteOne({ _id: filter._id });

      const deleted = typeof r?.deletedCount === "number" ? r.deletedCount : 0;
      if (deleted === 0) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("status", 404);
        this.ctx.set("error", {
          code: "NOT_FOUND",
          title: "Bad Request",
          detail: "No document matched the supplied id.",
        });
        this.log.warn(
          { event: "delete_not_found", id: idRaw },
          "Delete: document not found"
        );
        return;
      }

      // Success
      this.ctx.set("result", { ok: true, deleted: 1, id: idRaw });
      this.ctx.set("handlerStatus", "ok");
      this.log.info({ event: "delete_ok", id: idRaw }, "Delete succeeded");
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DB_OP_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
      });
      this.log.error(
        { event: "delete_error", err: err?.message },
        "Delete failed"
      );
    } finally {
      this.log.debug({ event: "execute_end" }, "dbDelete.delete exit");
    }
  }
}
