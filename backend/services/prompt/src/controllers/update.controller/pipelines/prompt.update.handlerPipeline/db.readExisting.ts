// backend/services/prompt/src/controllers/prompt.update.controller/handlers/db.readExisting.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0048 (Revised — bag-centric reads)
 * - ADR-0074 (DB_STATE guardrail, getDbVar())
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0106 (Lazy index ensure via persistence IndexGate)
 *
 * Purpose:
 * - Build DbReader<PromptDto> and load existing doc by canonical ctx["id"].
 * - Returns a **DtoBag** (0..1) as ctx["existingBag"] (does NOT overwrite ctx["bag"]).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :promptId)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "existingBag": DtoBag<PromptDto>  (size 0 or 1)
 * - "dbReader": DbReader<PromptDto>
 *
 * ADR-0106:
 * - DbReader is runtime-driven: it pulls mongo config + IndexGate via rt.
 * - Callers MUST NOT pass mongoUri/mongoDb.
 * - Handlers MUST NOT reference index contracts or IndexGate types.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import {
  DbReader,
  type DbReadDtoCtor,
} from "@nv/shared/dto/persistence/dbReader/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "backend/services/packages/dto/core/IDto";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

/**
 * ADR-0106:
 * - Keep handler typing free of index concepts.
 * - DbReader validates the index contract at the DB boundary.
 */
type UpdateDtoCtor = DbReadDtoCtor<IDto>;

export class DbReadExistingHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerJsonBase) {
    super(ctx, controller);
  }

  /**
   * Handler naming convention:
   * - db.<dbName>.<collection>.<op>
   *
   * For prompts:
   * - DB: nv
   * - Collection: prompts
   * - Op: find-one
   */
  public handlerName(): string {
    return "db.nv.prompts.find-one";
  }

  public handlerPurpose(): string {
    return 'DB read: load existing Prompt by id into ctx["existingBag"] (does not touch ctx["bag"]).';
  }

  protected async execute(): Promise<void> {
    this.log.debug(
      {
        event: "execute_enter",
        handler: this.handlerName(),
        id: this.ctx.get("id"),
      },
      "DbReadExistingHandler.execute enter"
    );

    const requestId = this.ctx.get("requestId");

    // --- Required id ---------------------------------------------------------
    const id = String(this.ctx.get("id") ?? "").trim();
    if (!id) {
      const status = 400;

      const problem = {
        type: "about:blank",
        title: "Bad Request",
        detail: "Path param :id is required.",
        status,
        code: "MISSING_ID",
        requestId,
        hint: "PATCH /api/prompt/v1/<id>/... with JSON body of fields to update.",
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.debug(
        {
          event: "execute_exit",
          reason: "missing_id",
          handler: this.handlerName(),
        },
        "DbReadExistingHandler.execute exit (missing id)"
      );
      return;
    }

    // --- Required dtoCtor ----------------------------------------------------
    const seededCtor = this.ctx.get<any>("update.dtoCtor");

    // NOTE:
    // - DTO classes are functions at runtime.
    // - Accept function OR object to avoid forcing wrappers.
    if (
      !seededCtor ||
      (typeof seededCtor !== "function" && typeof seededCtor !== "object")
    ) {
      const status = 500;

      const problem = {
        type: "about:blank",
        title: "Internal Error",
        detail:
          "DTO constructor missing/invalid in ctx as 'update.dtoCtor'. Ops: verify update pipeline wiring.",
        status,
        code: "DTO_CTOR_MISSING",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.error(
        {
          event: "execute_exit",
          reason: "dtoCtor_missing",
          handler: this.handlerName(),
          type: typeof seededCtor,
        },
        "DbReadExistingHandler.execute exit (DTO ctor missing/invalid)"
      );
      return;
    }

    const dtoCtor = seededCtor as unknown as UpdateDtoCtor;

    // Required handler-facing surface (no indexHints here).
    // DbReader enforces the index contract at the DB boundary (ADR-0106).
    if (typeof (dtoCtor as any)?.fromBody !== "function") {
      const status = 500;

      const problem = {
        type: "about:blank",
        title: "Internal Error",
        detail:
          "Invalid ctx['update.dtoCtor']: expected a DTO ctor with static fromBody().",
        status,
        code: "DTO_CTOR_INVALID",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.error(
        {
          event: "execute_exit",
          reason: "dtoCtor_missing_fromBody",
          handler: this.handlerName(),
        },
        "DbReadExistingHandler.execute exit (DTO ctor missing fromBody)"
      );
      return;
    }

    if (typeof (dtoCtor as any)?.dbCollectionName !== "function") {
      const status = 500;

      const problem = {
        type: "about:blank",
        title: "Internal Error",
        detail:
          "Invalid ctx['update.dtoCtor']: expected a DTO ctor with static dbCollectionName().",
        status,
        code: "DTO_CTOR_INVALID",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", problem);

      this.log.error(
        {
          event: "execute_exit",
          reason: "dtoCtor_missing_dbCollectionName",
          handler: this.handlerName(),
        },
        "DbReadExistingHandler.execute exit (DTO ctor missing dbCollectionName)"
      );
      return;
    }

    // --- Reader + fetch as **BAG** ------------------------------------------
    const validateReads =
      this.ctx.get<boolean>("update.validateReads") ?? false;

    const reader = new DbReader<IDto>({
      rt: this.rt,
      dtoCtor,
      validateReads,
    });
    this.ctx.set("dbReader", reader);

    try {
      const existingBag = await reader.readOneBagById({ id });
      this.ctx.set("existingBag", existingBag as DtoBag<IDto>);

      const size = Array.from(existingBag.items()).length;

      if (size === 0) {
        const status = 404;

        const problem = {
          type: "about:blank",
          title: "Not Found",
          detail: "No document found for supplied :id.",
          status,
          code: "NOT_FOUND",
          requestId,
          hint: "Confirm the id from create/read response; ensure same collection.",
        };

        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", status);
        this.ctx.set("response.body", problem);
        this.ctx.set("error", problem);

        this.log.debug(
          {
            event: "execute_exit",
            reason: "not_found",
            handler: this.handlerName(),
            id,
          },
          "DbReadExistingHandler.execute exit (not found)"
        );
        return;
      }

      if (size > 1) {
        const status = 500;

        const problem = {
          type: "about:blank",
          title: "Internal Error",
          detail:
            "Invariant breach: multiple records matched primary key lookup.",
          status,
          code: "MULTIPLE_MATCHES",
          requestId,
          hint: "Check unique index on _id and upstream normalization.",
        };

        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", status);
        this.ctx.set("response.body", problem);
        this.ctx.set("error", problem);

        this.log.warn(
          {
            event: "pk_multiple_matches",
            handler: this.handlerName(),
            id,
            count: size,
          },
          "DbReadExistingHandler expected singleton bag for id read"
        );
        return;
      }

      // Success path: do NOT touch ctx["bag"]; only existingBag/dbReader.
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "execute_exit",
          handler: this.handlerName(),
          id,
          size,
        },
        "DbReadExistingHandler.execute exit (success)"
      );
    } catch (rawError: any) {
      const status = 500;

      const problem = {
        type: "about:blank",
        title: "Internal Error",
        detail: "Database read failed while loading existing prompt.",
        status,
        code: "DB_READ_FAILED",
        requestId,
      };

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", status);
      this.ctx.set("response.body", problem);
      this.ctx.set("error", {
        problem,
        rawError,
      });

      this.log.error(
        {
          event: "db_read_failed",
          handler: this.handlerName(),
          id,
          requestId,
          rawError,
        },
        "DbReadExistingHandler.execute database read failed"
      );
    }
  }
}
