// backend/services/shared/src/http/handlers/dbRead.byId.get.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0053 (Bag Purity; only bags on the bus)
 *
 * Purpose:
 * - Shared GET-by-id handler for typed routes:
 *     GET /api/:slug/v:version/:dtoType/read/:id
 * - Validates :dtoType and :id, resolves the DTO constructor via DtoRegistry,
 *   and performs a single-record read using DbReader.readOneBagById().
 *
 * Final-handler invariants:
 * - On success:
 *   - ctx["bag"] MUST contain a DtoBag<DtoBase> with exactly one item.
 *   - ctx["handlerStatus"] MUST be "ok".
 *   - MUST NOT set ctx["result"].
 *   - MUST NOT set ctx["response.body"] on success.
 *   - ControllerBase.finalize() is responsible for calling bag.toJson()
 *     and building the wire payload (items[], meta, etc.).
 * - On error:
 *   - ctx["handlerStatus"] MUST be "error".
 *   - MUST set ctx["response.status"] (HTTP status).
 *   - MUST set ctx["response.body"] (problem+json-style object).
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

    const requestId =
      (this.ctx.get<string>("requestId") as string | undefined) ?? "unknown";

    const params: any = this.ctx.get("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.ctx.get<string>("dtoType") ?? "";

    // ---- Validate dtoType ---------------------------------------------------
    if (!dtoType) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':dtoType'.",
        hint: "Call GET /api/:slug/v:version/:dtoType/read/:id",
        requestId,
      });
      this.log.warn(
        { event: "bad_request", reason: "no_dtoType", requestId },
        "dbRead.byId — missing :dtoType"
      );
      return;
    }

    // ---- Validate id --------------------------------------------------------
    if (!rawId) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':id'.",
        hint: "Call GET /api/:slug/v:version/:dtoType/read/:id",
        requestId,
      });
      this.log.warn(
        { event: "bad_request", reason: "no_id", requestId },
        "dbRead.byId — missing :id"
      );
      return;
    }

    if (!isValidUuidV4(rawId)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_ID_FORMAT",
        title: "Bad Request",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        hint: "Use a UUIDv4 for the canonical DTO id.",
        requestId,
      });
      this.log.warn(
        {
          event: "bad_request",
          reason: "invalid_id_format",
          id: rawId,
          requestId,
        },
        "dbRead.byId — invalid id format"
      );
      return;
    }

    // ---- Registry & DTO ctor resolution ------------------------------------
    const registry = this.controller.getDtoRegistry?.();
    if (!registry || typeof registry.resolveCtorByType !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "REGISTRY_MISSING",
        title: "Internal Error",
        detail:
          "DtoRegistry missing or incomplete; cannot resolve DTO constructor.",
        hint: "AppBase must expose a DtoRegistry; ControllerBase wires it via getDtoRegistry().",
        requestId,
      });
      this.log.error(
        {
          event: "registry_missing",
          dtoType,
          hasRegistry: !!registry,
          requestId,
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
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "UNKNOWN_DTO_TYPE",
        title: "Bad Request",
        detail:
          e?.message ??
          `Unable to resolve DTO constructor for dtoType '${dtoType}'.`,
        hint: "Verify the DtoRegistry contains this dtoType.",
        requestId,
      });
      this.log.warn(
        {
          event: "dto_type_resolve_failed",
          dtoType,
          err: e?.message,
          requestId,
        },
        "dbRead.byId — failed to resolve dtoCtor"
      );
      return;
    }

    // ---- Env from HandlerBase.getVar (SvcEnv-driven) -----------------------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
        requestId,
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          handler: this.constructor.name,
          requestId,
        },
        "dbRead.byId aborted — Mongo env config missing"
      );
      return;
    }

    // ---- Read by id via DbReader -------------------------------------------
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
          requestId,
        },
        "dbRead.byId — target collection"
      );

      const bag: DtoBag<DtoBase> = await reader.readOneBagById({ id: rawId });

      const size =
        typeof (bag as any).count === "function"
          ? (bag as any).count()
          : typeof (bag as any).size === "function"
          ? (bag as any).size()
          : Array.from((bag as any).items?.() ?? []).length;

      if (size === 0) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 404);
        this.ctx.set("response.body", {
          code: "NOT_FOUND",
          title: "Not Found",
          detail: `No document matched id='${rawId}'`,
          hint: "Verify the id or re-read after writing.",
          requestId,
        });
        this.log.warn(
          {
            event: "read_not_found",
            id: rawId,
            dtoType,
            collectionName: tgt.collectionName,
            requestId,
          },
          "dbRead.byId — not found"
        );
        return;
      }

      if (size !== 1) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 500);
        this.ctx.set("response.body", {
          code: "READ_INVARIANT_VIOLATION",
          title: "Internal Error",
          detail: `Expected exactly 1 document for id='${rawId}', found ${size}.`,
          hint: "Check for duplicate ids or index issues on the underlying collection.",
          requestId,
        });
        this.log.error(
          {
            event: "read_invariant_violation",
            id: rawId,
            dtoType,
            collectionName: tgt.collectionName,
            size,
            requestId,
          },
          "dbRead.byId — invariant violated (size != 1)"
        );
        return;
      }

      // Success: leave the bag on ctx; finalize() will build the wire payload.
      this.ctx.set("bag", bag);
      this.ctx.set("handlerStatus", "ok");

      this.log.info(
        {
          event: "read_ok",
          id: rawId,
          dtoType,
          collectionName: tgt.collectionName,
          requestId,
        },
        "dbRead.byId — read succeeded"
      );
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "DB_READ_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
        hint: "Check Mongo connectivity, collection indexes, and env-service configuration.",
        requestId,
      });
      this.log.error(
        { event: "read_error", err: err?.message, requestId },
        "dbRead.byId — read failed"
      );
    } finally {
      this.log.debug({ event: "execute_end", requestId }, "dbRead.byId.exit");
    }
  }
}
