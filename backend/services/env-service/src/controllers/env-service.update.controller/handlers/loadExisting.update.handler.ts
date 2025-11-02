// backend/services/env-service/src/controllers/env-service.update.controller/handlers/loadExisting.update.handler.ts
/**
 * Purpose:
 * - Load existing DTO by envServiceId (string) and stash:
 *   • existingDto  (for patch step)
 *   • update.id    (canonical id for persistence)
 *
 * Invariants:
 * - Never mutate DTO to set id; id is carried out-of-band via ctx "update.id".
 */
import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class LoadExistingUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        title: "Internal Error",
        detail:
          "SvcEnvDto not in ctx. Ops: ensure ControllerBase seeds 'svcEnv'.",
      });
      return;
    }

    const params = (this.ctx.get("params") as Record<string, unknown>) ?? {};
    const query = (this.ctx.get("query") as Record<string, unknown>) ?? {};

    const idFromPath =
      (typeof params["envServiceId"] === "string" &&
        params["envServiceId"].trim()) ||
      (typeof params["id"] === "string" && params["id"].trim()) ||
      "";
    const idFromQuery =
      (typeof query["envServiceId"] === "string" &&
        (query["envServiceId"] as string).trim()) ||
      (typeof query["id"] === "string" && (query["id"] as string).trim()) ||
      "";
    const id = idFromPath || idFromQuery;

    if (!id) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "ID_REQUIRED",
        title: "Bad Request",
        detail: "Provide :envServiceId in path or ?envServiceId in query.",
      });
      return;
    }

    const reader = new DbReader<EnvServiceDto>({
      dtoCtor: EnvServiceDto,
      svcEnv,
      validateReads: false,
    });
    try {
      const t = await reader.targetInfo();
      this.log.debug(
        {
          event: "update_target",
          collection: t.collectionName,
          pk: "envServiceId",
        },
        "update target"
      );
    } catch {
      /* non-fatal */
    }

    const existing = await reader.readById(id);
    if (!existing) {
      this.ctx.set("handlerStatus", "warn");
      this.ctx.set("status", 404);
      this.ctx.set("error", {
        code: "NOT_FOUND",
        title: "Not Found",
        detail: `No record with envServiceId=${id}.`,
      });
      return;
    }

    // Expose for downstream steps
    this.ctx.set("existingDto", existing);
    this.ctx.set("update.id", id);

    this.ctx.set("handlerStatus", "ok");
    this.log.debug(
      { event: "load_existing_ok", id },
      "loadExisting.update exit"
    );
  }
}
