// backend/services/shared/src/http/handlers/db.readOne.byFilter.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; bag-centric reads
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047/0048 (All reads return DtoBag)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
 *
 * Purpose:
 * - Populate a DtoBag<TDto> from Mongo based on a filter, and stash it on the ctx bus.
 * - Generic, reusable handler — analogous to bag.populate.get.handler, but for DB queries.
 *
 * Config (from ctx):
 * - "bag.query.dtoCtor":          DTO class (required; must have fromBody + dbCollectionName)
 * - "bag.query.filter":          Record<string, unknown> (required)
 * - "bag.query.targetKey":       string ctx key to write the bag to (default: "bag")
 * - "bag.query.validateReads":   boolean (default: false)
 * - "bag.query.ensureSingleton": boolean (default: false)
 *
 * Outputs (ctx):
 * - [targetKey]: DtoBag<TDto>
 * - "db.reader": DbReader<TDto> (for logging/introspection if desired)
 * - "handlerStatus": "ok" | "error"
 *
 * Notes:
 * - This is a mid-pipeline helper; it does not build wire payloads.
 * - Final handlers are responsible for ensuring ctx["bag"] is the canonical
 *   bag used by ControllerBase.finalize().
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

export class DbReadOneByFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.readOne.byFilter";
  }

  protected handlerPurpose(): string {
    return "Populate a DtoBag<TDto> from Mongo based on a filter and stash it on the ctx bus.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.getHandlerName(),
        requestId,
      },
      "db.readOne.byFilter enter"
    );

    // ---- Config from ctx ----------------------------------------------------
    const dtoCtor = this.safeCtxGet<any>("bag.query.dtoCtor");
    const filter =
      this.safeCtxGet<Record<string, unknown>>("bag.query.filter") ?? {};
    const targetKey = this.safeCtxGet<string>("bag.query.targetKey") ?? "bag";
    const validateReads =
      this.safeCtxGet<boolean>("bag.query.validateReads") === true;
    const ensureSingleton =
      this.safeCtxGet<boolean>("bag.query.ensureSingleton") === true;

    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "bag_query_dto_ctor_missing",
        detail:
          "bag.query.dtoCtor missing or invalid. Dev: set ctx['bag.query.dtoCtor'] to the DTO class (with static fromBody/dbCollectionName).",
        stage: "db.readOne.byFilter:config.dtoCtor",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            targetKey,
            hasDtoCtor: !!dtoCtor,
            hasFromBody: !!dtoCtor?.fromBody,
          },
        ],
        logMessage:
          "db.readOne.byFilter: dtoCtor missing/invalid (bag.query.dtoCtor).",
        logLevel: "error",
      });
      return;
    }

    // ---- DB config comes from HandlerBase rails (override OR runtime) -------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // ---- External edge: DB read -------------------------------------------
    let bag: DtoBag<IDto>;
    let reader: DbReader<any> | undefined;

    try {
      reader = new DbReader<any>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads,
      });

      this.ctx.set("db.reader", reader);

      bag = (await reader.readOneBag({ filter })) as DtoBag<IDto>;
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "bag_query_failed",
        detail:
          "DbReader.readOneBag() failed while populating a query-based DtoBag. Ops: check Mongo availability, filter shape, and DTO collection configuration.",
        stage: "db.readOne.byFilter:db.readOneBag",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            targetKey,
            filter,
            validateReads,
          },
        ],
        rawError: err,
        logMessage: "db.readOne.byFilter: DbReader.readOneBag failed.",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set(targetKey, bag);

    // ---- Business invariant: ensureSingleton -------------------------------
    if (ensureSingleton) {
      const items = Array.from(bag.items());
      const size = items.length;

      if (size !== 1) {
        const status = size === 0 ? 404 : 500;

        this.failWithError({
          httpStatus: status,
          title:
            size === 0 ? "bag_query_not_found" : "bag_query_singleton_breach",
          detail:
            size === 0
              ? "No records matched the supplied filter."
              : `Invariant breach: expected exactly 1 record for the supplied filter; found ${size}.`,
          stage: "db.readOne.byFilter:business.ensureSingleton",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ targetKey, filter, size }],
          logMessage:
            size === 0
              ? "db.readOne.byFilter: no records matched filter (ensureSingleton)."
              : "db.readOne.byFilter: singleton invariant breached (ensureSingleton).",
          logLevel: size === 0 ? "info" : "error",
        });
        return;
      }
    }

    // Success
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "execute_exit",
        handler: this.getHandlerName(),
        targetKey,
        filterKeys: Object.keys(filter),
        ensureSingleton,
        requestId,
      },
      "db.readOne.byFilter exit"
    );
  }
}
