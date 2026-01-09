// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/seed.filter2.ts
/**
 * Docs:
 * - SOP: per-pipeline folders; handlers under ./handlers
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (DbEnvServiceDto — one doc per env@slug@version)
 *
 * Purpose:
 * - Seed ctx["bag.query.*"] for DbReadOneByFilterHandler to read the SERVICE-LOCAL
 *   config document (slug="<requested>") for the requested env + version.
 *
 * Invariants:
 * - This handler performs NO IO. It only seeds ctx for the next handler.
 * - Service-local config is OPTIONAL (ensureSingleton=false). If absent, root-only
 *   config still returns an effective config.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class SeedFilter2Handler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "seed.filter2";
  }

  protected handlerPurpose(): string {
    return "Seed query filter for service-local config for the next db.readOne.byFilter step.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const env = this.requireEnvLabel(requestId);
    const slug = this.requireQuerySlug(requestId);
    const version = this.requireQueryVersion(requestId);

    this.ctx.set("bag.query.dtoCtor", DbEnvServiceDto);
    this.ctx.set("bag.query.filter", { env, slug, version });
    this.ctx.set("bag.query.targetKey", "env.config.service.bag");
    this.ctx.set("bag.query.validateReads", false);
    this.ctx.set("bag.query.ensureSingleton", false);

    this.ctx.set("handlerStatus", "ok");
  }

  private requireEnvLabel(requestId: string): string {
    const v = this.safeCtxGet<any>("svc.env");
    if (typeof v === "string" && v.trim()) return v.trim();

    this.failWithError({
      httpStatus: 500,
      title: "seed_filter_env_missing",
      detail:
        "Missing ctx['svc.env'] while building env-service config filter. Dev: ControllerBase.makeContext must seed envLabel into ctx['svc.env'].",
      stage: "seed.filter2:env_missing",
      requestId,
      origin: { file: __filename, method: "requireEnvLabel" },
      logMessage: "seed.filter2: ctx['svc.env'] missing.",
      logLevel: "error",
    });

    return "";
  }

  private requireQuerySlug(requestId: string): string {
    const q = this.safeCtxGet<any>("query") ?? {};
    const raw = (q as any).slug;

    if (typeof raw === "string" && raw.trim()) return raw.trim();

    this.failWithError({
      httpStatus: 500,
      title: "seed_filter_slug_missing",
      detail:
        "Missing required query.slug while building env-service config filter. Dev: callers must supply ?slug=<service-slug> when calling /config.",
      stage: "seed.filter2:slug_missing",
      requestId,
      origin: { file: __filename, method: "requireQuerySlug" },
      issues: [{ haveQuery: !!q, queryKeys: Object.keys(q ?? {}) }],
      logMessage: "seed.filter2: query.slug missing/invalid.",
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
      stage: "seed.filter2:version_missing",
      requestId,
      origin: { file: __filename, method: "requireQueryVersion" },
      issues: [{ haveQuery: !!q, queryKeys: Object.keys(q ?? {}) }],
      logMessage: "seed.filter2: query.version missing/invalid.",
      logLevel: "error",
    });

    return 0;
  }
}
