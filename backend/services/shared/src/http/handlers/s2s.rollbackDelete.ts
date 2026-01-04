// backend/services/shared/src/http/handlers/s2s.rollbackDelete.ts
/**
 * Docs:
 * - SOP: MOS compensators are S2S only; no direct DB writes.
 * - ADRs:
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0098 (Domain-named pipelines with PL suffix)
 *
 * Purpose:
 * - Generic compensating rollback: perform an S2S delete when an explicit
 *   failure condition is met.
 *
 * IMPORTANT (Pipeline Helper Contract):
 * - Pipelines MUST seed the following ctx keys before this handler runs:
 *
 *   // condition gate
 *   ctx["rollback.whenKey"]     : string   (key to read)
 *   ctx["rollback.whenEquals"]  : unknown  (value that triggers rollback)
 *
 *   // target
 *   ctx["rollback.slug"]        : string
 *   ctx["rollback.version"]     : number
 *   ctx["rollback.dtoType"]     : string
 *   ctx["rollback.op"]          : string   (usually "delete")
 *   ctx["rollback.method"]      : string   (usually "DELETE")
 *
 *   // id + bag
 *   ctx["rollback.idKey"]       : string   (where to find the id, e.g. "step.rollback.id")
 *   ctx["rollback.bagKey"]      : string   (where to find the bag, usually "bag")
 *
 * - This handler is generic and has no domain knowledge.
 * - If you need domain mapping (like mapping ctx["step.uuid"] → ctx["step.rollback.id"]),
 *   do it in a pipeline helper step ("h_...") before this handler.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { ControllerBase } from "../../base/controller/ControllerBase";
import type { SvcClient } from "../../s2s/SvcClient";

export class S2sRollbackDeleteHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected override handlerName(): string {
    return "s2s.rollbackDelete";
  }

  protected handlerPurpose(): string {
    return "Generic compensator: when failure condition is met, S2S delete the target record.";
  }

  protected override canRunAfterError(): boolean {
    return true;
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const mustGetString = (key: string, stage: string): string | undefined => {
      const v = this.ctx.get<unknown>(key);
      if (typeof v === "string" && v.trim().length > 0) return v.trim();

      this.failWithError({
        httpStatus: 500,
        title: "rollback_config_missing_or_invalid",
        detail:
          `Rollback handler requires ctx['${key}'] to be a non-empty string. ` +
          "Dev: pipeline helper must seed rollback config keys before this handler runs.",
        stage,
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ key, valueType: typeof v, hasValue: v != null }],
        logMessage: `s2s.rollbackDelete: missing/invalid required config key '${key}'`,
        logLevel: "error",
      });

      return undefined;
    };

    const whenKey = mustGetString(
      "rollback.whenKey",
      "rollback.config.whenKey"
    );
    if (!whenKey) return;

    const whenEquals = this.ctx.get<unknown>("rollback.whenEquals");

    const slug = mustGetString("rollback.slug", "rollback.config.slug");
    if (!slug) return;

    const version = this.ctx.get<number>("rollback.version");
    if (typeof version !== "number" || !Number.isFinite(version)) {
      this.failWithError({
        httpStatus: 500,
        title: "rollback_config_missing_or_invalid",
        detail:
          "Rollback handler requires ctx['rollback.version'] to be a finite number. " +
          "Dev: pipeline helper must seed rollback target version.",
        stage: "rollback.config.version",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            key: "rollback.version",
            valueType: typeof version,
            value: version,
          },
        ],
        logMessage: "s2s.rollbackDelete: missing/invalid rollback.version",
        logLevel: "error",
      });
      return;
    }

    const dtoType = mustGetString(
      "rollback.dtoType",
      "rollback.config.dtoType"
    );
    if (!dtoType) return;

    const op = mustGetString("rollback.op", "rollback.config.op");
    if (!op) return;

    const method = mustGetString("rollback.method", "rollback.config.method");
    if (!method) return;

    const idKey = mustGetString("rollback.idKey", "rollback.config.idKey");
    if (!idKey) return;

    const bagKey = mustGetString("rollback.bagKey", "rollback.config.bagKey");
    if (!bagKey) return;

    const gateValue = this.ctx.get<unknown>(whenKey);
    const shouldRun = gateValue === whenEquals;

    if (!shouldRun) {
      this.log.debug(
        {
          event: "rollback_skip_gate_not_met",
          requestId,
          whenKey,
          gateValue,
        },
        "s2s.rollbackDelete: gate not met — no rollback"
      );
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    const id = this.ctx.get<string>(idKey);
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      this.failWithError({
        httpStatus: 500,
        title: "rollback_missing_id",
        detail:
          `Rollback gate met, but ctx['${idKey}'] was missing/empty — cannot delete target. ` +
          "Ops: potential orphan record; inspect and correct manually.",
        stage: "rollback.id_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ idKey, hasId: !!id, slug, version }],
        logMessage: "s2s.rollbackDelete: missing rollback id",
        logLevel: "error",
      });
      return;
    }

    const bag = this.ctx.get<any>(bagKey);
    if (!bag) {
      this.failWithError({
        httpStatus: 500,
        title: "rollback_missing_bag",
        detail:
          `Rollback requires ctx['${bagKey}'] to be present for S2S call. ` +
          "Dev: ensure pipeline/controller seeded a bag.",
        stage: "rollback.bag_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ bagKey, hasBag: !!bag, id: id.trim() }],
        logMessage: "s2s.rollbackDelete: missing rollback bag",
        logLevel: "error",
      });
      return;
    }

    const env = (this.rt.getEnv() ?? "").trim();
    if (!env) {
      this.failWithError({
        httpStatus: 500,
        title: "rollback_env_empty",
        detail:
          "Rollback requires a non-empty runtime env (rt.getEnv()). Ops: verify svcenv wiring.",
        stage: "rollback.env_empty",
        requestId,
        origin: { file: __filename, method: "execute" },
        logMessage: "s2s.rollbackDelete: empty env",
        logLevel: "error",
      });
      return;
    }

    const svcClient = this.rt.tryCap<SvcClient>("s2s.svcClient");
    if (!svcClient || typeof (svcClient as any).call !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "rollback_svcclient_missing",
        detail:
          'Rollback requires runtime capability "s2s.svcClient". Dev/Ops: wire it under the canonical key.',
        stage: "rollback.cap.s2s.svcClient",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasSvcClient: !!svcClient }],
        logMessage: "s2s.rollbackDelete: missing s2s.svcClient cap",
        logLevel: "error",
      });
      return;
    }

    this.log.info(
      { event: "rollback_begin", requestId, env, slug, version, id: id.trim() },
      "s2s.rollbackDelete: attempting rollback delete"
    );

    try {
      await svcClient.call({
        env,
        slug,
        version,
        dtoType,
        op,
        method,
        id: id.trim(),
        bag,
        requestId,
      });

      this.ctx.set("rollback.ok", true);
      this.ctx.set("handlerStatus", "ok");

      this.log.info(
        { event: "rollback_ok", requestId, slug, version, id: id.trim() },
        "s2s.rollbackDelete: rollback delete succeeded"
      );
    } catch (err) {
      this.ctx.set("rollback.ok", false);

      this.failWithError({
        httpStatus: 500,
        title: "rollback_delete_failed",
        detail:
          "Rollback delete attempt failed. Ops: potential orphan record; inspect and correct manually.",
        stage: "rollback.delete_failed",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ slug, version, id: id.trim(), rollbackOk: false }],
        rawError: err,
        logMessage: "s2s.rollbackDelete: rollback delete FAILED",
        logLevel: "error",
      });
    }
  }
}
