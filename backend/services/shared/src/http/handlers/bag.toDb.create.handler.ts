// backend/services/shared/src/http/handlers/bag.toDb.create.handler.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; bag-centric writes
 * - ADRs:
 *   - ADR-0040/0041/0042/0043
 *   - ADR-0048 (All writes accept DtoBag)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0053 (Bag Purity; final handler leaves DtoBag only)
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
 * - [targetKey]: DtoBag<DtoBase> (now set to the **persisted** bag)
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
} from "@nv/shared/dto/persistence/DbWriter";

export class BagToDbCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Persist a DtoBag<DtoBase> via DbWriter and expose the persisted bag on ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "bag.toDb.create enter"
    );

    // ---- Config / bag validation (no external edge) ------------------------
    const targetKey =
      (this.ctx.get<string>("bag.write.targetKey") as string | undefined) ??
      "bag";
    const ensureSingleton =
      this.ctx.get<boolean>("bag.write.ensureSingleton") ?? true;

    const bag = this.ctx.get<DtoBag<DtoBase>>(targetKey);
    if (!bag) {
      this.failWithError({
        httpStatus: 500,
        title: "bag_write_bag_missing",
        detail: `No DtoBag found on ctx['${targetKey}']. Dev: ensure upstream handlers populated this entry before bag.toDb.create.handler.`,
        stage: "config.bag",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          collection: undefined,
        },
        issues: [{ targetKey, hasBag: !!bag }],
        logMessage:
          "bag.toDb.create — required DtoBag missing from context at targetKey.",
        logLevel: "error",
      });
      return;
    }

    if (ensureSingleton) {
      const size = Array.from(bag.items()).length;
      if (size !== 1) {
        const code =
          size === 0 ? "BAG_WRITE_EMPTY" : "BAG_WRITE_TOO_MANY_ITEMS";

        this.failWithError({
          httpStatus: 400,
          title: "bag_write_singleton_violation",
          detail:
            size === 0
              ? "Create requires exactly one item in the bag; received 0."
              : `Create requires exactly one item in the bag; received ${size}.`,
          stage: "business.ensureSingleton",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ targetKey, size, code }],
          logMessage:
            "bag.toDb.create — singleton requirement failed for create operation.",
          logLevel: "warn",
        });
        return;
      }
    }

    // ---- Env from HandlerBase.getVar (strict, no fallbacks) ----------------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.failWithError({
        httpStatus: 500,
        title: "mongo_env_missing",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in EnvServiceDto._vars for this service. Ops: ensure env-service config is populated for this slug/env/version.",
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
          "bag.toDb.create aborted — Mongo env config missing (NV_MONGO_URI / NV_MONGO_DB).",
        logLevel: "error",
      });
      return;
    }

    // ---- External edge: DB write (fine-grained try/catch) ------------------
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
      const persisted = persistedBag.getSingleton();

      // Persisted bag back onto the bus:
      this.ctx.set(targetKey, persistedBag);

      // Finalize invariant: always expose the persisted bag on ctx["bag"].
      if (targetKey !== "bag") {
        this.ctx.set("bag", persistedBag);
      }

      // Track last inserted id for downstream diagnostics/logging.
      this.ctx.set("dbWriter.lastId", persisted.getId());

      // Success: handler leaves only the bag; finalize() will build the wire payload.
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "execute_exit",
          handler: this.constructor.name,
          targetKey,
          id: persisted.getId(),
          collection: persisted.requireCollectionName(),
          requestId,
        },
        "bag.toDb.create exit"
      );
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        this.failWithError({
          httpStatus: 409,
          title: "duplicate_key",
          detail:
            err.message ??
            "Duplicate key encountered while attempting to create a new document.",
          stage: "db.write.duplicateKey",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              targetKey,
            },
          ],
          rawError: err,
          logMessage: "bag.toDb.create — duplicate key on DbWriter.write().",
          logLevel: "warn",
        });
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "bag_write_failed",
        detail:
          (err as Error)?.message ??
          "DbWriter.write() failed while persisting a DtoBag.",
        stage: "db.write",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            targetKey,
            hasBag: !!bag,
          },
        ],
        rawError: err,
        logMessage:
          "bag.toDb.create — unexpected error during DbWriter.write().",
        logLevel: "error",
      });
    }
  }
}
