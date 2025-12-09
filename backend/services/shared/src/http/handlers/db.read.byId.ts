// backend/services/shared/src/http/handlers/db.read.byId.ts
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
 *   - ControllerBase.finalize() is responsible for calling bag.toBody()
 *     and building the wire payload (items[], meta, etc.).
 * - On error:
 *   - ctx["handlerStatus"] MUST be "error".
 *   - ctx["status"] MUST be set (HTTP status).
 *   - ctx["error"] MUST carry an NvHandlerError (ProblemDetails source).
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import { DbReader } from "../../dto/persistence/dbReader/DbReader";
import type { DtoBag } from "../../dto/DtoBag";
import type { DtoBase } from "../../dto/DtoBase";
import { isValidUuidV4 } from "../../utils/uuid";

type DtoCtorWithCollection<T> = {
  fromBody: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string;
  name?: string;
};

export class DbReadByIdHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Read a single DTO by UUIDv4 id for typed routes and attach a singleton DtoBag to ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_start",
        handler: this.constructor.name,
        requestId,
      },
      "dbRead.byId.enter"
    );

    // ---- Params & basic validation (no external edges) ---------------------
    const params: any = this.safeCtxGet<any>("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.safeCtxGet<string>("dtoType") ?? "";

    // Validate dtoType
    if (!dtoType) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_dto_type",
        detail: "Missing required path parameter ':dtoType'.",
        stage: "params.dtoType",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [{ reason: "no_dtoType" }],
        logMessage:
          "dbRead.byId — missing :dtoType (GET /api/:slug/v:version/:dtoType/read/:id).",
        logLevel: "warn",
      });
      return;
    }

    // Validate id presence
    if (!rawId) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_id",
        detail: "Missing required path parameter ':id'.",
        stage: "params.id",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [{ reason: "no_id" }],
        logMessage:
          "dbRead.byId — missing :id (GET /api/:slug/v:version/:dtoType/read/:id).",
        logLevel: "warn",
      });
      return;
    }

    // Validate id format
    if (!isValidUuidV4(rawId)) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_id_format",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        stage: "params.idFormat",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            id: rawId,
            expected: "uuidv4",
          },
        ],
        logMessage:
          "dbRead.byId — invalid id format; expected UUIDv4 for canonical DTO id.",
        logLevel: "warn",
      });
      return;
    }

    const id = rawId;

    // ---- Registry & DTO ctor resolution ------------------------------------
    const registry = (this.controller as any).getDtoRegistry?.();
    if (!registry || typeof registry.resolveCtorByType !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "registry_missing",
        detail:
          "DtoRegistry missing or incomplete; cannot resolve DTO constructor.",
        stage: "config.registry",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          dtoType,
        },
        issues: [
          {
            dtoType,
            hasRegistry: !!registry,
            hasResolveCtorByType:
              typeof registry?.resolveCtorByType === "function",
          },
        ],
        logMessage:
          "dbRead.byId — registry missing or resolveCtorByType() not available.",
        logLevel: "error",
      });
      return;
    }

    let dtoCtor: DtoCtorWithCollection<DtoBase>;
    try {
      dtoCtor = registry.resolveCtorByType(
        dtoType
      ) as unknown as DtoCtorWithCollection<DtoBase>;
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "unknown_dto_type",
        detail:
          (err as Error)?.message ??
          `Unable to resolve DTO constructor for dtoType '${dtoType}'.`,
        stage: "config.dtoCtorFromRegistry",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          dtoType,
        },
        issues: [{ dtoType }],
        rawError: err,
        logMessage:
          "dbRead.byId — failed to resolve DTO constructor from DtoRegistry.",
        logLevel: "warn",
      });
      return;
    }

    // ---- Env from HandlerBase.getVar (SvcEnv-driven) -----------------------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.failWithError({
        httpStatus: 500,
        title: "mongo_env_missing",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        stage: "config.mongoEnv",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            mongoUriPresent: !!mongoUri,
            mongoDbPresent: !!mongoDb,
          },
        ],
        logMessage:
          "dbRead.byId aborted — Mongo env config missing (NV_MONGO_URI / NV_MONGO_DB).",
        logLevel: "error",
      });
      return;
    }

    // ---- External edge: read by id via DbReader ----------------------------
    let collectionName = "";
    try {
      const reader = new DbReader<DtoBase>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads: false,
      });

      const tgt = await reader.targetInfo();
      collectionName = tgt.collectionName;

      this.log.debug(
        {
          event: "read_target",
          collection: collectionName,
          dtoType,
          id,
          requestId,
        },
        "dbRead.byId — target collection"
      );

      const bag: DtoBag<DtoBase> = await reader.readOneBagById({ id });

      const size =
        typeof (bag as any).count === "function"
          ? (bag as any).count()
          : typeof (bag as any).size === "function"
          ? (bag as any).size()
          : Array.from((bag as any).items?.() ?? []).length;

      if (size === 0) {
        this.failWithError({
          httpStatus: 404,
          title: "not_found",
          detail: `No document matched id='${id}'`,
          stage: "db.readOneBagById.notFound",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
            collection: collectionName,
          },
          issues: [
            {
              id,
              dtoType,
              collection: collectionName,
            },
          ],
          logMessage:
            "dbRead.byId — readOneBagById() returned empty bag (NOT_FOUND).",
          logLevel: "warn",
        });
        return;
      }

      if (size !== 1) {
        this.failWithError({
          httpStatus: 500,
          title: "read_invariant_violation",
          detail: `Expected exactly 1 document for id='${id}', found ${size}.`,
          stage: "db.readOneBagById.invariant",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
            collection: collectionName,
          },
          issues: [
            {
              id,
              dtoType,
              collection: collectionName,
              size,
            },
          ],
          logMessage:
            "dbRead.byId — invariant violated: readOneBagById() returned size != 1.",
          logLevel: "error",
        });
        return;
      }

      // Success: leave the bag on ctx; finalize() will build the wire payload.
      this.ctx.set("bag", bag);
      this.ctx.set("handlerStatus", "ok");

      this.log.info(
        {
          event: "read_ok",
          id,
          dtoType,
          collectionName,
          requestId,
        },
        "dbRead.byId — read succeeded"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_read_failed",
        detail:
          (err as Error)?.message ??
          "DbReader.readOneBagById() failed while attempting to read a document by id.",
        stage: "db.readOneBagById",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          collection: collectionName || undefined,
        },
        issues: [
          {
            id,
            dtoType,
            collection: collectionName || "unknown",
          },
        ],
        rawError: err,
        logMessage:
          "dbRead.byId — unexpected error during DbReader.readOneBagById().",
        logLevel: "error",
      });
    }

    this.log.debug(
      {
        event: "execute_end",
        handler: this.constructor.name,
        requestId,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "ok",
      },
      "dbRead.byId.exit"
    );
  }
}
