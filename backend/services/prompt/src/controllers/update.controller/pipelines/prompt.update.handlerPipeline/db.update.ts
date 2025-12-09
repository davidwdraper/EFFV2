// backend/services/prompt/src/controllers/prompt.update.controller/handlers/db.update.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0048 (Revised — all reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; no naked DTOs on the bus)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Consume the UPDATED **singleton DtoBag** from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<PromptDto>   (UPDATED singleton; from CodePatchHandler / ApplyPatchUpdateHandler)
 *
 * Outputs (ctx):
 * - "updatedId": string
 * - "result": { ok: true, id }
 * - "handlerStatus": "ok" | "error"
 * - "response.status": number              (on error; success finalized by controller)
 * - "response.body": RFC7807 problem       (on error)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

export class DbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Handler naming convention:
   * - db.<dbName>.<collectionName>.<op>
   *
   * For prompts:
   * - DB: nv
   * - Collection: prompts
   * - Op: update-one
   */
  public handlerName(): string {
    return "db.nv.prompts.update-one";
  }

  /**
   * Short, human-readable description used in logs / consoles.
   */
  public handlerPurpose(): string {
    return "DB update: apply singleton PromptDto bag to Mongo and record updatedId/result.";
  }

  protected async execute(): Promise<void> {
    // Normalize requestId to a safe string (HandlerContext.get may return {}).
    const requestIdRaw = this.ctx.get("requestId");
    const requestId =
      typeof requestIdRaw === "string" && requestIdRaw.trim() !== ""
        ? requestIdRaw
        : "unknown";

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.handlerName(),
        requestId,
      },
      "DbUpdateHandler.execute enter"
    );

    // --- Required context ----------------------------------------------------
    const bag = this.ctx.get<DtoBag<any>>("bag");
    if (!bag) {
      this._badRequest(
        "BAG_MISSING",
        "Updated DtoBag missing. Ensure CodePatchHandler/ApplyPatchUpdateHandler ran.",
        requestId
      );
      return;
    }

    const items = Array.from(bag.items());
    if (items.length !== 1) {
      this._badRequest(
        items.length === 0 ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
        items.length === 0
          ? "Update requires exactly one item; received 0."
          : "Update requires exactly one item; received more than 1.",
        requestId
      );
      return;
    }

    // --- Env via HandlerBase.getVar (aligned with create handler) -----------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    // Optional: diagnose whether ControllerBase is actually holding svcEnv.
    const svcEnv = this.controller.getSvcEnv?.();
    const hasSvcEnv = !!svcEnv;

    if (!mongoUri || !mongoDb) {
      const status = 500;
      const problem = {
        type: "about:blank",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        status,
        code: "MONGO_ENV_MISSING",
        requestId,
        hint: "Check env-service for NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.error(
        {
          event: "mongo_env_missing",
          hasSvcEnv,
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          handler: this.handlerName(),
          requestId,
        },
        "DbUpdateHandler.execute aborted — Mongo env config missing"
      );
      return;
    }

    // --- Writer (bag-centric; use DtoBase for DbWriter contract) ------------
    const baseBag = bag as unknown as DtoBag<DtoBase>;
    const writer = new DbWriter<DtoBase>({
      bag: baseBag,
      mongoUri,
      mongoDb,
      log: this.log,
    });

    try {
      const { collectionName } = (await writer.targetInfo?.()) ?? {
        collectionName: "<unknown>",
      };

      this.log.debug(
        {
          event: "update_target",
          handler: this.handlerName(),
          collection: collectionName,
          requestId,
        },
        "DbUpdateHandler.execute will write to collection"
      );

      // Bag-centric update; writer determines the id from the DTO inside the bag.
      const { id } = await writer.update();

      this.log.debug(
        {
          event: "update_complete",
          handler: this.handlerName(),
          id,
          collection: collectionName,
          requestId,
        },
        "DbUpdateHandler.execute update complete"
      );

      this.ctx.set("updatedId", id);
      this.ctx.set("result", { ok: true, id });
      this.ctx.set("handlerStatus", "ok");
      // Success: do NOT set response.status/body; controller finalize() owns the wire.
    } catch (err: any) {
      if (err instanceof DuplicateKeyError) {
        const keyObj = err.key ?? {};
        const keyPath = Object.keys(keyObj).join(",");

        const warning = {
          code: "DUPLICATE",
          message: "Unique constraint violation (duplicate key).",
          detail: (err as Error).message,
          index: err.index,
          key: err.key,
        };
        this.ctx.set("warnings", [
          ...(this.ctx.get<any[]>("warnings") ?? []),
          warning,
        ]);

        const status = 409;
        const problem = {
          type: "about:blank",
          title: "Conflict",
          detail: (err as Error).message,
          status,
          code: "DUPLICATE",
          requestId,
          issues: keyPath
            ? [
                {
                  path: keyPath,
                  code: "unique",
                  message: "duplicate value",
                },
              ]
            : undefined,
        };

        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", status);
        this.ctx.set("response.body", problem);
        this.ctx.set("error", problem);

        this.log.warn(
          {
            event: "duplicate_key",
            handler: this.handlerName(),
            index: err.index,
            key: err.key,
            detail: (err as Error).message,
            requestId,
          },
          "DbUpdateHandler.execute duplicate key — returning 409"
        );
        return;
      }

      // Let unexpected errors bubble to the pipeline-level try/catch;
      // it will log and map to a 500 Problem once, consistently.
      throw err;
    }

    this.log.debug(
      {
        event: "execute_exit",
        handler: this.handlerName(),
        requestId,
      },
      "DbUpdateHandler.execute exit"
    );
  }

  private _badRequest(code: string, detail: string, requestId: string): void {
    const status = 400;
    const problem = {
      type: "about:blank",
      title: "Bad Request",
      detail,
      status,
      code,
      requestId,
    };

    this.ctx.set("handlerStatus", "error");
    this.ctx.set("response.status", status);
    this.ctx.set("response.body", problem);
    this.ctx.set("error", problem);

    this.log.warn(
      {
        event: "bad_request",
        handler: this.handlerName(),
        code,
        requestId,
      },
      "DbUpdateHandler.execute bad request"
    );
  }
}
