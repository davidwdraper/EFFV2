// backend/services/shared/src/http/handlers/code.set.dtoId.ts
/**
 * Docs:
 * - SOP: handlers do work; controllers orchestrate; no fallbacks
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0047 (DtoBag & Views)
 * - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 * - ADR-0057 (ID Generation & Validation — UUIDv4; immutable)
 * - ADR-0101 (Seeder→handler pairs; noop seeding is explicit)
 *
 * Purpose:
 * - Apply a UUID baton from ctx onto the bagged DTO's `_id` (set-once).
 * - Intended usage:
 *   - Prior step minted a UUID to ctx["step.uuid"] (e.g., code.mint.uuid)
 *   - This handler applies that UUID to the DTO(s) inside ctx["bag"]
 *
 * Handler IO Contract (ctx)
 * - Inputs (required unless noted):
 *   - ctx["bag"] : DtoBag<IDto>
 *     - Source: controller hydration (edge) or prior handler
 *     - Meaning: primary DTO payload being assembled for downstream steps
 *     - Failure: rails error (500) if missing/invalid
 *   - ctx["step.uuid"] : string (UUIDv4)
 *     - Source: prior handler (typically code.mint.uuid)
 *     - Meaning: write-once identifier to become DTO `_id`
 *     - Failure: rails error (500) if missing/invalid
 *
 * - Outputs (this handler writes):
 *   - DTO `_id` set via dto.setIdOnce(uuid) (success-only)
 *
 * - Error contract reminder:
 *   - On failure: must set ctx["handlerStatus"]="error" and ctx["response.status"] + ctx["response.body"].
 *   - On success: must not set error keys; success payload remains in ctx["bag"].
 */

import type { HandlerContext } from "../handlers/HandlerContext";
import type { ControllerBase } from "../../base/controller/ControllerBase";
import { HandlerBase } from "../handlers/HandlerBase";

import { validateUUIDString } from "../../utils/uuid";
import { DtoBag } from "../../dto/DtoBag";

type LoggerLike = {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export class CodeSetDtoIdHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override getHandlerName(): string {
    return "code.set.dtoId";
  }

  protected handlerPurpose(): string {
    return "Apply a UUID baton from ctx onto the bagged DTO's `_id` (set-once).";
  }

  protected override async execute(): Promise<void> {
    const ctx = this.ctx;
    const log = ctx.get<LoggerLike>("log");
    const requestId = ctx.get<string>("requestId");

    let bag: DtoBag<any> | undefined;
    try {
      bag = ctx.get<DtoBag<any>>("bag");
    } catch {}

    if (!bag || typeof (bag as any)?.items !== "function") {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        title: "ctx_missing_bag",
        detail:
          "code.set.dtoId requires ctx['bag'] (DtoBag) but it was missing/invalid.",
        requestId,
      });
      return;
    }

    let uuidRaw: unknown;
    try {
      uuidRaw = ctx.get("step.uuid");
    } catch {
      uuidRaw = undefined;
    }

    if (typeof uuidRaw !== "string" || !uuidRaw.trim()) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        title: "ctx_missing_step_uuid",
        detail:
          "code.set.dtoId requires ctx['step.uuid'] (UUIDv4 string) but it was missing.",
        requestId,
      });
      return;
    }

    let uuid: string;
    try {
      uuid = validateUUIDString(uuidRaw);
    } catch (err: any) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        title: "step_uuid_invalid",
        detail:
          err instanceof Error
            ? err.message
            : "ctx['step.uuid'] was not a valid UUIDv4 string.",
        requestId,
      });
      return;
    }

    const it = bag.items();
    const first = it.next();

    if (first.done || !first.value) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        title: "bag_empty",
        detail: "code.set.dtoId requires a non-empty ctx['bag'].",
        requestId,
      });
      return;
    }

    // Apply to every DTO in the bag (safe: set-once; no overwrite).
    // If a DTO already has an id, we leave it alone.
    let appliedCount = 0;

    const applyToDto = (dto: any) => {
      if (!dto) return;

      const hasId =
        typeof dto.hasId === "function" ? Boolean(dto.hasId()) : false;

      if (hasId) return;

      if (typeof dto.setIdOnce !== "function") {
        throw new Error(
          "DTO_ID_SETTER_MISSING: bag item does not expose setIdOnce(id)."
        );
      }

      dto.setIdOnce(uuid);
      appliedCount++;
    };

    try {
      // apply to first (already pulled)
      applyToDto(first.value);

      // apply to remaining
      for (let n = it.next(); !n.done; n = it.next()) {
        applyToDto(n.value);
      }
    } catch (err: any) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        title: "dto_id_apply_failed",
        detail:
          err instanceof Error
            ? err.message
            : "Failed to apply dto _id from ctx['step.uuid'].",
        requestId,
      });
      return;
    }

    log?.info?.(
      {
        event: "code_set_dto_id_applied",
        handler: this.getHandlerName(),
        requestId,
        uuid,
        appliedCount,
      },
      "code.set.dtoId: applied uuid to dto(s) without an id"
    );
  }
}
