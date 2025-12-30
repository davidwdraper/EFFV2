// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/code.guard.serviceRoot.ts
/**
 * Docs:
 * - SOP: per-pipeline folders; single-purpose handlers; fail-fast with Ops guidance
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *
 * Purpose:
 * - Forbid direct reads of the reserved "service-root" record via /config.
 *
 * Why:
 * - /config returns a merged view: root + service.
 * - Asking for slug="service-root" would attempt to merge root into root (nonsense)
 *   and also re-opens the door to “raw-ish” reads by accident.
 *
 * Invariant:
 * - If the requested slug is "service-root" (exact), hard-fail.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { Request } from "express";

export class CodeGuardServiceRootHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public getHandlerName(): string {
    return "code.guard.serviceRoot";
  }

  protected handlerPurpose(): string {
    return 'Reject /config reads that request slug="service-root" (reserved root record).';
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    // Best-effort slug resolution:
    // - Prefer ctx keys if present (seeders may already normalize query)
    // - Fall back to Express req.query.slug if ctx stores req
    const fromCtx =
      (
        this.tryGetString("slug") ??
        this.tryGetString("query.slug") ??
        this.tryGetString("env.slug") ??
        this.tryGetString("svc.slug")
      )?.trim() ?? "";

    const fromReq = this.tryGetQuerySlugFromReq() ?? "";

    const requested = (fromCtx || fromReq).trim();

    // If slug isn't available yet, don't guess here — downstream seed/validation owns it.
    if (!requested) {
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    if (requested === "service-root") {
      // Log structured context first (FailWithErrorInput doesn't accept arbitrary meta).
      this.log.warn(
        {
          event: "env_config_service_root_forbidden",
          requestId,
          requestedSlug: requested,
        },
        'env-service.config.guard.serviceRoot: rejected slug="service-root" (reserved)'
      );

      this.failWithError({
        httpStatus: 400,
        title: "service_root_direct_read_forbidden",
        detail:
          'Direct reads of slug="service-root" are forbidden. Dev/Ops: request a concrete service slug; /config returns the merged (root+service) view only.',
        stage: "guard.serviceRoot",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          'env-service.config.guard.serviceRoot: forbidden direct read of slug="service-root".',
        logLevel: "warn",
      });
      return;
    }

    this.ctx.set("handlerStatus", "ok");
  }

  private tryGetString(key: string): string | undefined {
    try {
      const v = this.ctx.get(key);
      if (typeof v !== "string") return undefined;
      const s = v.trim();
      return s ? s : undefined;
    } catch {
      return undefined;
    }
  }

  private tryGetQuerySlugFromReq(): string | undefined {
    try {
      const req = this.ctx.get("req") as Request | undefined;
      const q = req?.query as any;
      const raw = q?.slug;
      if (typeof raw === "string") return raw.trim() || undefined;
      if (Array.isArray(raw) && typeof raw[0] === "string") {
        return raw[0].trim() || undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
