// backend/services/prompt/src/controllers/prompt.update.controller/handlers/db.update.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0048 (Revised — all reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound; canonical id="_id")
 *   - ADR-0053 (Bag Purity; no naked DTOs on the bus)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0106 (DB operators take SvcRuntime; index logic lives at DB boundary)
 *
 * Purpose:
 * - Consume the UPDATED **singleton DtoBag** from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<PromptDto>   (UPDATED singleton; from CodePatchHandler)
 *
 * Outputs (ctx):
 * - Success:
 *   - "bag": unchanged (still the UPDATED singleton bag)
 *   - "handlerStatus": "ok"
 * - Error:
 *   - "handlerStatus": "error"
 *   - "response.status"
 *   - "response.body"
 *
 * Invariants:
 * - On success, this handler MUST NOT write ctx["result"] or ctx["response.body"].
 *   ControllerBase.finalize() owns the wire payload.
 * - No mongoUri/mongoDb/index logic at call sites (ADR-0106).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import {
  DbWriter,
  DuplicateKeyError,
  type DbWriteDtoCtor,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

type WriteDtoCtor = DbWriteDtoCtor<DtoBase>;

export class DbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerJsonBase) {
    super(ctx, controller);
  }

  public handlerName(): string {
    return "db.nv.prompts.update-one";
  }

  public handlerPurpose(): string {
    return "DB update: apply singleton PromptDto bag to Mongo; success remains bag-only for controller finalize().";
  }

  protected async execute(): Promise<void> {
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

    const bag = this.ctx.get<DtoBag<any>>("bag");
    if (!bag) {
      this._badRequest(
        "BAG_MISSING",
        "Updated DtoBag missing. Ensure CodePatchHandler ran.",
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

    // ADR-0106: DbWriter needs dtoCtor for collection targeting.
    // Index contract validation remains inside DbWriter.
    const dtoCtor = this.ctx.get("db.dtoCtor") as WriteDtoCtor | undefined;
    if (!dtoCtor) {
      this._badRequest(
        "DTOCTOR_MISSING",
        "DB dtoCtor missing. Dev: seed ctx['db.dtoCtor'] with the DB DTO constructor before db.update runs.",
        requestId
      );
      return;
    }

    const baseBag = bag as unknown as DtoBag<DtoBase>;
    const writer = new DbWriter<DtoBase>({
      rt: this.rt,
      dtoCtor,
      bag: baseBag,
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

      await writer.update();

      // Success: bag already contains the updated DTO (from CodePatchHandler).
      // Do NOT set ctx["result"] or ctx["response.*"] here.
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "update_complete",
          handler: this.handlerName(),
          collection: collectionName,
          requestId,
        },
        "DbUpdateHandler.execute update complete"
      );
    } catch (err: any) {
      if (err instanceof DuplicateKeyError) {
        const keyObj = err.key ?? {};
        const keyPath = Object.keys(keyObj).join(",");

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

      // Unexpected errors: let rails handle consistent mapping/logging upstream.
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
