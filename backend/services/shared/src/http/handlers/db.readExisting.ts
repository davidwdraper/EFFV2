// backend/services/shared/src/http/handlers/db.readExisting.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 *
 * Purpose:
 * - Build DbReader<DtoBase> and load existing doc by canonical ctx["id"].
 * - Returns a **DtoBag** (0..1) as ctx["existingBag"] (does NOT overwrite ctx["bag"]).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or route param)
 * - "update.dtoCtor": DTO class (required; must expose static fromBody())
 *
 * Outputs (ctx):
 * - "existingBag": DtoBag<DtoBase>  (size 0..1)
 * - "dbReader": DbReader<DtoBase>
 * - "handlerStatus": "ok" | "error"
 * - On error only:
 *   - ctx["error"]: NvHandlerError (mapped to ProblemDetails by finalize)
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import { DbReader } from "../../dto/persistence/dbReader/DbReader";
import type { DtoBag } from "../../dto/DtoBag";
import type { IDto } from "../../dto/IDto";
import type { DtoBase } from "../../dto/DtoBase";

export class DbReadExistingHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Load an existing document by ctx['id'] via DbReader and expose it as ctx['existingBag'] (0..1 items).";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "execute_enter", handler: this.constructor.name, requestId },
      "db.readExisting enter"
    );

    const id = String(this.ctx.get("id") ?? "").trim();
    if (!id) {
      this.failWithError({
        httpStatus: 400,
        title: "missing_id",
        detail: "Path param :id is required to load an existing document.",
        stage: "config.id",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ idValue: this.ctx.get("id") }],
        logMessage: "db.readExisting — ctx['id'] is missing or empty.",
        logLevel: "warn",
      });
      return;
    }

    const dtoCtor = this.ctx.get<any>("update.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing",
        detail:
          "DTO constructor missing in ctx as 'update.dtoCtor' or missing static fromBody(). Dev: ensure controller seeds a valid DTO ctor.",
        stage: "config.dtoCtor",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasDtoCtor: !!dtoCtor, hasFromBody: !!dtoCtor?.fromBody }],
        logMessage: "db.readExisting — invalid ctx['update.dtoCtor'].",
        logLevel: "error",
      });
      return;
    }

    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();
    const validateReads =
      this.ctx.get<boolean>("update.validateReads") ?? false;

    let existingBag: DtoBag<IDto>;

    try {
      const reader = new DbReader<DtoBase>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads,
      });

      this.ctx.set("dbReader", reader);

      const bag = await reader.readOneBagById({ id });
      existingBag = bag as unknown as DtoBag<IDto>;
      this.ctx.set("existingBag", existingBag);
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_read_failed",
        detail:
          (err as Error)?.message ??
          "DbReader.readOneBagById() failed while reading existing document.",
        stage: "db.read",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ id, validateReads }],
        rawError: err,
        logMessage: "db.readExisting — DbReader.readOneBagById() threw.",
        logLevel: "error",
      });
      return;
    }

    const size = Array.from(existingBag.items()).length;

    if (size === 0) {
      this.failWithError({
        httpStatus: 404,
        title: "not_found",
        detail: "No document found for supplied :id.",
        stage: "business.notFound",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ id, size }],
        logMessage: "db.readExisting — existingBag empty.",
        logLevel: "warn",
      });
      return;
    }

    if (size > 1) {
      this.failWithError({
        httpStatus: 500,
        title: "multiple_matches",
        detail:
          "Invariant breach: multiple records matched primary key lookup. Check unique index on _id.",
        stage: "business.multipleMatches",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ id, size }],
        logMessage: "db.readExisting — expected singleton bag, got many.",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "execute_exit",
        handler: this.constructor.name,
        id,
        size,
        requestId,
      },
      "db.readExisting exit — existing DTO loaded into ctx['existingBag']"
    );
  }
}
