// backend/services/env-service/src/controllers/env-service.update.controller/handlers/applyPatch.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence)
 * - ADR-0041 (Per-route controllers; thin handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Apply request body patch onto the existing DTO without mutating it.
 *
 * Invariants:
 * - envServiceId is immutable; reject attempts to change it.
 * - JSON only at the edge; DTOs inside.
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export class ApplyPatchUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const existing = this.ctx.get<EnvServiceDto>("existingDto");
    const id = this.ctx.get<string>("update.id");

    if (!existing || !id) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MISSING_EXISTING",
        title: "Internal Server Error",
        detail: "Existing DTO or update.id missing from context.",
      });
      return;
    }

    const rawBody = this.ctx.get("body");
    if (!isPlainObject(rawBody)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "PATCH_NOT_OBJECT",
        title: "Bad Request",
        detail: "Patch body must be a JSON object.",
      });
      return;
    }

    // ID is immutable: if present and mismatched → 400; if same → strip.
    if (Object.prototype.hasOwnProperty.call(rawBody, "envServiceId")) {
      const requested = String((rawBody as any).envServiceId ?? "");
      if (requested && requested !== id) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("status", 400);
        this.ctx.set("error", {
          code: "ID_IMMUTABLE",
          title: "Bad Request",
          detail: `envServiceId is immutable (got ${requested}, expected ${id}).`,
        });
        return;
      }
      delete (rawBody as any).envServiceId;
    }

    // TS-safe merge: narrow both sides to plain objects before spread.
    const base: Record<string, unknown> = existing.toJson() as Record<
      string,
      unknown
    >;
    const patch: Record<string, unknown> = rawBody as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...base, ...patch };

    let dto: EnvServiceDto;
    try {
      dto = EnvServiceDto.fromJson(merged, { validate: true });
    } catch (e: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "PATCH_INVALID",
        title: "Bad Request",
        detail: e?.message ?? "Patch validation failed.",
      });
      return;
    }

    // Hand off: writer uses ctx['update.id'] as canonical key; DTO has updated fields.
    this.ctx.set("dto", dto);
    this.ctx.set("handlerStatus", "ok");
    this.log.debug({ event: "patched" }, "DTO patched via fromJson(merged)");
  }
}
