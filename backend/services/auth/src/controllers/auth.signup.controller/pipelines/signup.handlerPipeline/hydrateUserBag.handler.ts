// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/hydrateUserBag.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; edge → DTO)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *   - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Hydrate a singleton DtoBag<UserDto> from the inbound wire bag.
 * - Apply the canonical userId minted earlier in the pipeline (ctx["signup.userId"])
 *   via UserDto.setIdOnce().
 *
 * Invariants:
 * - Auth MOS owns id minting. UserDto never invents ids.
 * - ctx["signup.userId"] MUST be set by BuildSignupUserIdHandler.
 * - setIdOnce() enforces UUIDv4, immutability, and consistency across User/UserAuth.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { BagItemWire } from "@nv/shared/registry/RegistryBase";

import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDto, type UserJson } from "@nv/shared/dto/user.dto";

export class HydrateUserBagHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const rawRequestId = this.ctx.get("requestId");
    const requestId =
      typeof rawRequestId === "string" && rawRequestId.trim().length > 0
        ? rawRequestId.trim()
        : undefined;

    const dtoType = this.ctx.get<string>("dtoType");

    this.log.debug(
      { event: "execute_enter", dtoType, requestId },
      "signup.hydrateUserBag: enter handler"
    );

    // ───────────────────────────────────────────────────────────────
    // 0) Ensure signup.userId exists from BuildSignupUserIdHandler
    // ───────────────────────────────────────────────────────────────
    const userId = this.ctx.get<string | undefined>("signup.userId");

    if (!userId) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "SIGNUP_USER_ID_MISSING",
        title: "Internal Server Error",
        detail:
          "Auth signup expected ctx['signup.userId'] to be populated before hydration. " +
          "Dev: ensure BuildSignupUserIdHandler ran first in the pipeline.",
        requestId,
      });

      this.log.error(
        {
          event: "signup_user_id_missing",
          dtoType,
          requestId,
        },
        "signup.hydrateUserBag: ctx['signup.userId'] missing before hydration"
      );

      return;
    }

    // ───────────────────────────────────────────────────────────────
    // 1) Wire-bag shape validation
    // ───────────────────────────────────────────────────────────────
    const body = this.ctx.get<any>("body");

    if (!body || !Array.isArray(body.items)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "WIRE_BAG_INVALID",
        title: "Bad Request",
        detail:
          "Expected a wire bag envelope with 'items: []'. Dev: ensure auth.signup sends { items: [ { type: 'user', ...UserJson } ] }.",
        requestId,
      });

      this.log.warn(
        {
          event: "wire_bag_invalid",
          bodyType: typeof body,
          hasItems: !!body?.items,
        },
        "signup.hydrateUserBag: missing or invalid items[] on inbound payload"
      );
      return;
    }

    const size = body.items.length;
    if (size !== 1) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: size === 0 ? "WIRE_BAG_EMPTY" : "WIRE_BAG_TOO_MANY_ITEMS",
        title: "Bad Request",
        detail:
          size === 0
            ? "Signup requires exactly one item in the wire bag; received 0."
            : `Signup requires exactly one item in the wire bag; received ${size}.`,
        requestId,
      });

      this.log.warn(
        {
          event: "wire_bag_wrong_size",
          size,
        },
        "signup.hydrateUserBag: singleton requirement failed"
      );
      return;
    }

    const item = body.items[0] as BagItemWire | undefined;
    if (!item || typeof item !== "object") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "WIRE_BAG_ITEM_INVALID",
        title: "Bad Request",
        detail:
          "Wire bag item must be a DTO-like object with a 'type' field. Dev: ensure items[0] is an object with type='user' and UserDto fields.",
        requestId,
      });

      this.log.warn(
        {
          event: "wire_bag_item_invalid",
          itemType: typeof item,
        },
        "signup.hydrateUserBag: invalid first item in wire bag"
      );
      return;
    }

    const itemType = (item as any).type;
    if (!itemType || itemType !== dtoType) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "WIRE_BAG_TYPE_MISMATCH",
        title: "Bad Request",
        detail: `Wire bag item.type='${itemType}' does not match expected dtoType='${dtoType}'. Dev: call /api/auth/v1/user/signup with dtoType='user' and item.type='user'.`,
        requestId,
      });

      this.log.warn(
        {
          event: "wire_bag_type_mismatch",
          itemType,
          dtoType,
        },
        "signup.hydrateUserBag: dtoType/type mismatch"
      );
      return;
    }

    // ───────────────────────────────────────────────────────────────
    // 2) DTO hydration and id injection via setIdOnce()
    // ───────────────────────────────────────────────────────────────
    try {
      const dto = UserDto.fromBody(item as Partial<UserJson>, {
        validate: true,
      });

      // Immutable id assignment (ADR-0057)
      dto.setIdOnce(userId);

      const { bag } = BagBuilder.fromDtos([dto], {
        requestId,
        limit: 1,
        total: 1,
        cursor: null,
      });

      this.ctx.set("bag", bag);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "execute_exit",
          dtoType,
          requestId,
          bagSize: bag.size(),
        },
        "signup.hydrateUserBag: populated ctx['bag'] with singleton UserDto bag (id applied)"
      );
    } catch (err) {
      const message =
        (err as Error)?.message ??
        "Failed to hydrate UserDto or apply id via setIdOnce().";

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "USER_DTO_VALIDATION_FAILED",
        title: "Bad Request",
        detail: message,
        requestId,
      });

      this.log.warn(
        {
          event: "user_dto_validation_failed",
          error: message,
        },
        "signup.hydrateUserBag: UserDto.fromBody() or setIdOnce() validation failed"
      );
    }
  }
}
