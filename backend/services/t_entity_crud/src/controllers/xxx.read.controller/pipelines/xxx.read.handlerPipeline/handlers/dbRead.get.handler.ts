// backend/services/t_entity_crud/src/controllers/xxx.read.controller/handlers/dbRead.get.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0048 (DbReader contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Single-record read by **primary key only** ("id", string).
 *
 * Behavior:
 * - Success (200): returns DtoBag envelope
 *   { items: [dtoJson], meta: { cursor:null, limit:1, total:1, requestId } }
 * - Missing id (400): { code:"BAD_REQUEST_MISSING_ID", ... }
 * - Not found (404): { items: [], meta: { cursor:null, limit:1, total:0, requestId } }
 *
 * Invariants:
 * - Canonical id field is strictly "id". No fallbacks, no filter path.
 * - Self-contained: constructs its own DbReader.
 * - svcEnv is obtained from ControllerBase via HandlerBase (no ctx plumbing).
 * - dtoCtor must be seeded by the pipeline via ctx.set("read.dtoCtor", XxxDto).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { IDto } from "@nv/shared/dto/IDto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";

export class DbReadGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    // svcEnv comes from the controller (no ctx lookups for it)
    const svcEnv = this.controller.getSvcEnv?.();

    // dtoCtor is intentionally per-route seed via ctx (controller/pipeline decides which DTO)
    const dtoCtor = this.ctx.get<any>("read.dtoCtor");

    if (!dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "READ_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required context missing (read.dtoCtor). Ops: verify the read pipeline seeds the DTO constructor.",
      });
      return;
    }

    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_DTO_MISSING",
        title: "Internal Error",
        detail:
          "EnvServiceDto missing from ControllerBase. Ops: ensure AppBase exposes svcEnv and controller extends ControllerBase correctly.",
      });
      return;
    }

    // Derive Mongo connection info from svcEnv (ADR-0044; tolerant to shape)
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
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          hasSvcEnv: !!svcEnv,
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
        },
        "read aborted — Mongo env config missing"
      );
      return;
    }

    const params = (this.ctx.get("params") as Record<string, unknown>) ?? {};
    const query = (this.ctx.get("query") as Record<string, unknown>) ?? {};
    const requestId =
      (this.ctx.get<string>("requestId") as string) || "unknown";

    const id =
      (typeof params["id"] === "string" && params["id"].trim()) ||
      (typeof query["id"] === "string" && (query["id"] as string).trim()) ||
      "";

    if (!id) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_MISSING_ID",
        title: "Bad Request",
        detail:
          "Route requires an 'id' path or query parameter. Example: GET /api/xxx/v1/:dtoType/read/<id>",
        requestId,
      });
      return;
    }

    const reader = new DbReader<any>({
      dtoCtor,
      mongoUri,
      mongoDb,
      validateReads: false,
      idFieldName: "id", // canonical
    });

    // Instrument target collection (best-effort; non-fatal)
    try {
      const t = await reader.targetInfo();
      this.log.debug(
        { event: "read_target", collection: t.collectionName, pk: "id" },
        "read will query collection"
      );
    } catch {
      /* ignore — target info is best-effort */
    }

    try {
      // Bag-centric read
      const bag = await reader.readOneBagById({ id });

      // 404 if empty
      const size = Array.from(bag.items()).length;
      if (size === 0) {
        this.ctx.set("handlerStatus", "warn");
        this.ctx.set("response.status", 404);
        this.ctx.set("response.body", {
          items: [],
          meta: { cursor: null, limit: 1, total: 0, requestId },
        });
        this.log.debug(
          { event: "read_one_by_id_not_found", id },
          "no record by id"
        );
        return;
      }

      // Success: build wire envelope
      const itemJson = Array.from(bag.items()).map((d: IDto) => d.toJson());
      const { meta } = BagBuilder.fromDtos([], {
        requestId,
        limit: 1,
        total: 1,
        cursor: null,
      });

      this.ctx.set("response.status", 200);
      this.ctx.set("response.body", { items: itemJson, meta });
      this.ctx.set("handlerStatus", "ok");
      this.log.debug(
        { event: "read_one_by_id", id },
        "read one by id complete"
      );
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "DB_OP_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
        requestId,
      });
      this.log.error(
        { event: "read_error", err: err?.message, id },
        "Read failed"
      );
    }
  }
}
