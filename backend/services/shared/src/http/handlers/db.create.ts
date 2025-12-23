// backend/services/shared/src/http/handlers/db.create.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; bag-centric writes
 * - ADRs:
 *   - ADR-0040/0041/0042/0043
 *   - ADR-0048 (All writes accept DtoBag)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0053 (Bag Purity; final handler leaves DtoBag only)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Take a DtoBag<DtoBase> from the ctx bus and persist it via DbWriter.
 * - Generic "create" handler, reusable across services.
 * - Final handler invariant:
 *   - On success: leave a DtoBag on ctx["bag"] (and on [targetKey], if configured).
 *   - Only ControllerBase.finalize() builds wire payloads from bag.toBody().
 *
 * Config (ctx):
 * - "bag.write.targetKey":       string ctx key to READ/WRITE the bag (default: "bag")
 * - "bag.write.ensureSingleton": boolean (default: true)
 *
 * Inputs (ctx):
 * - [targetKey]: DtoBag<DtoBase> (required)
 * - "userId": string (optional; typically from JWT, used for meta stamping)
 *
 * Outputs (ctx):
 * - [targetKey]: DtoBag<DtoBase> (now set to the persisted bag)
 * - "bag": DtoBag<DtoBase> (alias for [targetKey] to satisfy finalize() invariant)
 * - "dbWriter.lastId": string (id used for the insert)
 * - "handlerStatus": "ok" | "error"
 * - On error only:
 *   - ctx["error"]: NvHandlerError (mapped to ProblemDetails by finalize)
 *
 * Invariants (Handler-level):
 * - No success payloads outside of a DtoBag.
 * - No ctx["result"] writes.
 * - No ctx["response.body"] on success.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

export class DbCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.create";
  }

  protected handlerPurpose(): string {
    return "Persist a DtoBag<DtoBase> via DbWriter and expose the persisted bag on ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.getHandlerName(),
        requestId,
      },
      "db.create enter"
    );

    // ---- Config / bag validation (no external edge) ------------------------
    const targetKey = this.safeCtxGet<string>("bag.write.targetKey") ?? "bag";
    const ensureSingleton =
      this.safeCtxGet<boolean>("bag.write.ensureSingleton") !== false;

    const bag = this.safeCtxGet<DtoBag<DtoBase>>(targetKey);
    if (!bag) {
      this.failWithError({
        httpStatus: 500,
        title: "bag_write_bag_missing",
        detail: `No DtoBag found on ctx['${targetKey}']. Dev: ensure upstream handlers populated this entry before db.create.`,
        stage: "db.create:config.bag",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ targetKey, hasBag: false }],
        logMessage: "db.create: required DtoBag missing at targetKey.",
        logLevel: "error",
      });
      return;
    }

    if (ensureSingleton) {
      const size = Array.from(bag.items()).length;
      if (size !== 1) {
        this.failWithError({
          httpStatus: 400,
          title: "bag_write_singleton_violation",
          detail:
            size === 0
              ? "Create requires exactly one item in the bag; received 0."
              : `Create requires exactly one item in the bag; received ${size}.`,
          stage: "db.create:business.ensureSingleton",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ targetKey, size }],
          logMessage: "db.create: singleton requirement failed.",
          logLevel: "warn",
        });
        return;
      }
    }

    // ---- Missing DB config throws (sandbox rails) --------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // ---- External edge: DB write ------------------------------------------
    const userId = this.safeCtxGet<string>("userId");

    try {
      const writer = new DbWriter<DtoBase>({
        bag: bag as DtoBag<DtoBase>,
        mongoUri,
        mongoDb,
        log: this.log,
        userId,
      });

      const persistedBag = await writer.write();

      // Persisted bag back onto the bus:
      this.ctx.set(targetKey, persistedBag);

      // Finalize invariant: always expose the persisted bag on ctx["bag"].
      if (targetKey !== "bag") this.ctx.set("bag", persistedBag);

      // Track last inserted id for downstream diagnostics/logging.
      const persisted = persistedBag.getSingleton();
      this.ctx.set("dbWriter.lastId", persisted.getId());

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "execute_exit",
          handler: this.getHandlerName(),
          targetKey,
          id: persisted.getId(),
          collection: persisted.requireCollectionName(),
          requestId,
        },
        "db.create exit"
      );
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        this.failWithError({
          httpStatus: 409,
          title: "duplicate_key",
          detail:
            err.message ??
            "Duplicate key encountered while attempting to create a new document.",
          stage: "db.create:db.write.duplicateKey",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ targetKey }],
          rawError: err,
          logMessage: "db.create: duplicate key on DbWriter.write().",
          logLevel: "warn",
        });
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "bag_write_failed",
        detail:
          err instanceof Error
            ? err.message
            : "DbWriter.write() failed while persisting a DtoBag.",
        stage: "db.create:db.write",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ targetKey, hasBag: true }],
        rawError: err,
        logMessage: "db.create: unexpected error during DbWriter.write().",
        logLevel: "error",
      });
    }
  }
}
