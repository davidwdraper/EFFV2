// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/seed.filter1.ts
/**
 * Docs:
 * - SOP: per-pipeline folders; handlers under ./handlers
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (DbEnvServiceDto — one doc per env@slug@version)
 *
 * Purpose:
 * - Seed ctx["bag.query.*"] for DbReadOneByFilterHandler to read the ROOT config
 *   document (slug="service-root") for the requested env + version.
 *
 * Invariants:
 * - This handler performs NO IO. It only seeds ctx for the next handler.
 * - Root read is REQUIRED (ensureSingleton=true).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";

const ROOT_SLUG = "service-root";

export class SeedFilter1Handler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "seed.filter1";
  }

  protected handlerPurpose(): string {
    return `Seed query filter for root config (slug="${ROOT_SLUG}") for the next db.readOne.byFilter step.`;
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const env = this.requireEnvLabel(requestId);
    const version = this.requireQueryVersion(requestId);

    this.ctx.set("bag.query.dtoCtor", DbEnvServiceDto);
    this.ctx.set("bag.query.filter", { env, slug: ROOT_SLUG, version });
    this.ctx.set("bag.query.targetKey", "env.config.root.bag");
    this.ctx.set("bag.query.validateReads", false);
    this.ctx.set("bag.query.ensureSingleton", true);

    this.ctx.set("handlerStatus", "ok");
  }

  private requireEnvLabel(requestId: string): string {
    // ControllerBase.makeContext seeds ctx["svc.env"] (see controllerContext.ts).
    const v = this.safeCtxGet<any>("svc.env");
    if (typeof v === "string" && v.trim()) return v.trim();

    this.failWithError({
      httpStatus: 500,
      title: "seed_filter_env_missing",
      detail:
        "Missing ctx['svc.env'] while building env-service config filter. Dev: ControllerBase.makeContext must seed envLabel into ctx['svc.env'].",
      stage: "seed.filter1:env_missing",
      requestId,
      origin: { file: __filename, method: "requireEnvLabel" },
      logMessage: "seed.filter1: ctx['svc.env'] missing.",
      logLevel: "error",
    });

    return "";
  }

  private requireQueryVersion(requestId: string): number {
    const q = this.safeCtxGet<any>("query") ?? {};
    const raw = (q as any).version;

    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.trunc(raw);
    }
    if (typeof raw === "string" && raw.trim()) {
      const n = Number(raw.trim());
      if (Number.isFinite(n) && n > 0) return Math.trunc(n);
    }

    this.failWithError({
      httpStatus: 500,
      title: "seed_filter_version_missing",
      detail:
        "Missing required query.version while building env-service config filter. Dev: callers must supply ?version=<positive int> when calling /config.",
      stage: "seed.filter1:version_missing",
      requestId,
      origin: { file: __filename, method: "requireQueryVersion" },
      issues: [{ haveQuery: !!q, queryKeys: Object.keys(q ?? {}) }],
      logMessage: "seed.filter1: query.version missing/invalid.",
      logLevel: "error",
    });

    return 0;
  }
}
