// backend/services/shared/src/http/handlers/db.delete.byId.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0056 (Typed routes use dtoKey; handler resolves collection via Registry)
 *   - ADR-0057 (UUID)
 *   - ADR-0102 (Registry sole DTO creation authority)
 *   - ADR-0103 (DTO naming convention: keys)
 *
 * Purpose:
 * - Generic DELETE-by-id handler for typed routes.
 *
 * Invariant:
 * - ctx["dtoKey"] is the registry key (ADR-0103), e.g. "db.user.dto"
 * - Collection is resolved via registry.resolve(dtoKey).collectionName
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import { DbDeleter } from "../../dto/persistence/dbDeleter/DbDeleter";
import { isValidUuid } from "../../utils/uuid";
import { DtoBag } from "../../dto/DtoBag";
import type { IDtoRegistry } from "../../registry/IDtoRegistry";

export class DbDeleteByIdHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.delete.byId";
  }

  protected handlerPurpose(): string {
    return "Delete a single document by UUIDv4 id using dtoKey and the Registry for collection resolution.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const params = this.safeCtxGet<any>("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoKey = (this.safeCtxGet<string>("dtoKey") ?? "").trim();

    if (!dtoKey) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_dto_key",
        detail:
          "Missing required route dtoKey (expected ADR-0103 key like 'db.user.dto').",
        stage: "db.delete.byId:params.dtoKey",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ reason: "no_dtoKey" }],
        logMessage: "db.delete.byId: missing dtoKey.",
        logLevel: "warn",
      });
      return;
    }

    if (!rawId) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_id",
        detail: "Missing required path parameter ':id'.",
        stage: "db.delete.byId:params.id",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ reason: "no_id" }],
        logMessage: "db.delete.byId: missing :id.",
        logLevel: "warn",
      });
      return;
    }

    if (!isValidUuid(rawId)) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_id_format",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        stage: "db.delete.byId:params.idFormat",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ id: rawId, expected: "uuidv4" }],
        logMessage: "db.delete.byId: invalid id format; expected UUIDv4.",
        logLevel: "warn",
      });
      return;
    }

    const registry: IDtoRegistry = this.controller.getDtoRegistry();

    let collectionName = "";
    try {
      const entry = (registry as any)?.resolve?.(dtoKey);
      collectionName =
        entry && typeof entry.collectionName === "string"
          ? entry.collectionName.trim()
          : "";

      if (!collectionName) {
        throw new Error(`No collection mapped for dtoKey="${dtoKey}"`);
      }
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "unknown_dto_key",
        detail:
          err instanceof Error
            ? err.message
            : `Unable to resolve collection for dtoKey "${dtoKey}".`,
        stage: "db.delete.byId:config.collectionFromDtoKey",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ dtoKey }],
        rawError: err,
        logMessage:
          "db.delete.byId: failed to resolve collection via Registry.resolve(dtoKey).collectionName.",
        logLevel: "warn",
      });
      return;
    }

    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    try {
      const deleter = new DbDeleter({ mongoUri, mongoDb, collectionName });

      const { deleted } = await deleter.deleteById(rawId);

      if (deleted === 0) {
        this.failWithError({
          httpStatus: 404,
          title: "not_found",
          detail: "No document matched the supplied id.",
          stage: "db.delete.byId:db.notFound",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
            collection: collectionName,
          },
          issues: [{ id: rawId, collection: collectionName }],
          logMessage: "db.delete.byId: no document matched supplied id.",
          logLevel: "warn",
        });
        return;
      }

      const bag = this.safeCtxGet<DtoBag<any>>("bag") ?? new DtoBag<any>([]);
      this.ctx.set("bag", bag);
      this.ctx.set("handlerStatus", "ok");
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_op_failed",
        detail:
          err instanceof Error ? err.message : "DbDeleter.deleteById() failed.",
        stage: "db.delete.byId:db.deleteById",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          collection: collectionName,
        },
        issues: [{ id: rawId, dtoKey, collection: collectionName }],
        rawError: err,
        logMessage: "db.delete.byId: unexpected error during deleteById().",
        logLevel: "error",
      });
    }
  }
}
