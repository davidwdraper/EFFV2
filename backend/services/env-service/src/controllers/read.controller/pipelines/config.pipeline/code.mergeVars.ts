// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/code.mergeVars.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; bag-centric reads; controller finalizes from ctx["bag"]
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (DbEnvServiceDto — one doc per env@slug@version)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0050 (Wire Bag Envelope)
 *
 * Purpose:
 * - Merge vars from:
 *   1) ctx["env.config.root.bag"] (service-root)
 *   2) ctx["env.config.service.bag"] (requested service; optional)
 * - Service vars overlay root vars (service wins on collisions).
 * - Output is a singleton effective config bag at ctx["bag"].
 *
 * Invariants:
 * - Never leak DTO internals; use getVarsRaw() defensive copies.
 * - Do NOT use DbEnvServiceDto.patchFrom() for this step (it patches identity fields).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class CodeMergeVarsHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "code.mergeVars";
  }

  protected handlerPurpose(): string {
    return "Merge service-local vars over root vars and emit an effective DbEnvServiceDto bag.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const rootBag = this.safeCtxGet<any>("env.config.root.bag");
    const svcBag = this.safeCtxGet<any>("env.config.service.bag");

    const rootDtos = this.bagToArray(rootBag);
    if (rootDtos.length !== 1) {
      this.failWithError({
        httpStatus: rootDtos.length === 0 ? 404 : 500,
        title:
          rootDtos.length === 0
            ? "env_config_root_missing"
            : "env_config_root_singleton_breach",
        detail:
          rootDtos.length === 0
            ? 'Root env config (slug="service-root") was not found.'
            : `Invariant breach: expected exactly 1 root config DTO; found ${rootDtos.length}.`,
        stage: "code.mergeVars:root.singleton",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ rootCount: rootDtos.length }],
        logMessage: "code.mergeVars: root singleton invariant failed.",
        logLevel: rootDtos.length === 0 ? "info" : "error",
      });
      return;
    }

    const rootDto = rootDtos[0];

    const svcDtos = this.bagToArray(svcBag);
    if (svcDtos.length > 1) {
      this.failWithError({
        httpStatus: 500,
        title: "env_config_service_singleton_breach",
        detail: `Invariant breach: expected 0 or 1 service-local config DTO; found ${svcDtos.length}.`,
        stage: "code.mergeVars:service.singleton",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ serviceCount: svcDtos.length }],
        logMessage: "code.mergeVars: service singleton invariant breached.",
        logLevel: "error",
      });
      return;
    }

    const svcDto: DbEnvServiceDto | undefined = svcDtos[0];

    const env = this.requireEnvLabel(requestId);
    const slug = this.requireQuerySlug(requestId);
    const version = this.requireQueryVersion(requestId);

    const rootVars = this.requireVars(rootDto, "root", requestId);
    const svcVars = svcDto
      ? this.requireVars(svcDto, "service", requestId)
      : {};

    // Merge vars (service overlays root).
    const mergedVars: Record<string, unknown> = {
      ...rootVars,
      ...svcVars,
    };

    // Build an effective DTO with requested identity.
    const effective = DbEnvServiceDto.fromBody(
      {
        env,
        slug,
        version,
        vars: mergedVars,
      },
      { validate: true }
    );

    // Emit as the canonical singleton bag for ControllerBase.finalize().
    const bag = this.makeSingletonBag(effective);
    this.ctx.set("bag", bag);

    this.ctx.set("handlerStatus", "ok");
  }

  // ───────────────────────────────────────────
  // Local helpers (no shared dependencies)
  // ───────────────────────────────────────────

  private bagToArray(bag: any): DbEnvServiceDto[] {
    if (!bag) return [];

    try {
      if (typeof bag.items === "function") {
        return Array.from(bag.items()) as DbEnvServiceDto[];
      }
    } catch {
      // fall through
    }

    if (Array.isArray(bag)) return bag as DbEnvServiceDto[];

    return [];
  }

  private makeSingletonBag(dto: DbEnvServiceDto): any {
    const anyBag = DtoBag as any;

    if (typeof anyBag.fromDtos === "function") {
      return anyBag.fromDtos([dto]);
    }

    if (typeof anyBag.fromItems === "function") {
      return anyBag.fromItems([dto]);
    }

    return new anyBag([dto]);
  }

  private requireVars(dto: any, which: "root" | "service", requestId: string) {
    try {
      const vars = dto?.getVarsRaw?.();
      if (!vars || typeof vars !== "object") {
        throw new Error(`${which}.getVarsRaw returned non-object`);
      }
      return vars as Record<string, unknown>;
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "env_config_vars_unreadable",
        detail:
          `Unable to read vars from ${which} DbEnvServiceDto (getVarsRaw failed). ` +
          "Dev: ensure DbEnvServiceDto exposes getVarsRaw() returning an object.",
        stage: `code.mergeVars:${which}.vars`,
        requestId,
        origin: { file: __filename, method: "requireVars" },
        rawError: err,
        logMessage: "code.mergeVars: getVarsRaw failed.",
        logLevel: "error",
      });
      return {};
    }
  }

  private requireEnvLabel(requestId: string): string {
    const v = this.safeCtxGet<any>("svc.env");
    if (typeof v === "string" && v.trim()) return v.trim();

    this.failWithError({
      httpStatus: 500,
      title: "merge_vars_env_missing",
      detail:
        "Missing ctx['svc.env'] while building effective env config identity. Dev: ControllerBase.makeContext must seed envLabel into ctx['svc.env'].",
      stage: "code.mergeVars:env_missing",
      requestId,
      origin: { file: __filename, method: "requireEnvLabel" },
      logMessage: "code.mergeVars: ctx['svc.env'] missing.",
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
      title: "merge_vars_slug_missing",
      detail:
        "Missing required query.slug while building effective env config identity. Dev: callers must supply ?slug=<service-slug> when calling /config.",
      stage: "code.mergeVars:slug_missing",
      requestId,
      origin: { file: __filename, method: "requireQuerySlug" },
      issues: [{ haveQuery: !!q, queryKeys: Object.keys(q ?? {}) }],
      logMessage: "code.mergeVars: query.slug missing/invalid.",
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
      title: "merge_vars_version_missing",
      detail:
        "Missing required query.version while building effective env config identity. Dev: callers must supply ?version=<positive int> when calling /config.",
      stage: "code.mergeVars:version_missing",
      requestId,
      origin: { file: __filename, method: "requireQueryVersion" },
      issues: [{ haveQuery: !!q, queryKeys: Object.keys(q ?? {}) }],
      logMessage: "code.mergeVars: query.version missing/invalid.",
      logLevel: "error",
    });

    return 0;
  }
}
