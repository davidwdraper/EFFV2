// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/toBag.user.ts

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
 *   - Build-a-test-guide (Handler-level test pattern: canonical test + scenarios)
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

// Test-runner wiring
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { ToBagUserTest } from "./toBag.user.test";

export class ToBagUserHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Handler identity:
   * - Used by logging AND by the test-runner to locate the test module.
   * - Must match the base file name: "toBag.user" → "toBag.user.test.ts".
   */
  protected override handlerName(): string {
    return "toBag.user";
  }

  /**
   * Canonical handler-test entrypoint:
   * - Bridges this handler to its primary smoke test class.
   * - ScenarioRunner separately uses getScenarios() from the test module.
   */
  public override async runTest(): Promise<HandlerTestResult | undefined> {
    return this.runSingleTest(ToBagUserTest);
  }

  protected handlerPurpose(): string {
    return "Hydrate a singleton UserDto bag from the inbound wire payload and apply the pre-minted signup user id.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const dtoType = this.safeCtxGet<string>("dtoType");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        dtoType,
        requestId,
      },
      "signup.hydrateUserBag: enter handler"
    );

    try {
      // 0) Ensure signup.userId was minted upstream
      const userId = this.safeCtxGet<string>("signup.userId");

      if (!userId || userId.trim().length === 0) {
        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_user_id_missing",
          detail:
            "Auth signup expected ctx['signup.userId'] to be populated before hydration. Dev: ensure BuildSignupUserIdHandler ran first.",
          stage: "preconditions.signup.userId",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ hasUserId: !!userId }],
          logMessage:
            "signup.hydrateUserBag: ctx['signup.userId'] missing before hydration.",
          logLevel: "error",
        });
        return;
      }

      // 1) wire-bag shape checks
      const body = this.safeCtxGet<any>("body");
      if (!body || !Array.isArray(body.items)) {
        this.failWithError({
          httpStatus: 400,
          title: "wire_bag_invalid",
          detail:
            "Expected a wire bag envelope with items[]. Dev: ensure inbound payload conforms to bag shape.",
          stage: "wire_bag.shape",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ bodyType: typeof body, hasItems: !!body?.items }],
          logMessage:
            "signup.hydrateUserBag: missing or invalid items[] on inbound payload.",
          logLevel: "warn",
        });
        return;
      }

      const size = body.items.length;
      if (size !== 1) {
        const code = size === 0 ? "WIRE_BAG_EMPTY" : "WIRE_BAG_TOO_MANY_ITEMS";
        this.failWithError({
          httpStatus: 400,
          title: code.toLowerCase(),
          detail:
            size === 0
              ? "Signup requires exactly one item; received 0."
              : `Signup requires exactly one item; received ${size}.`,
          stage: "wire_bag.cardinality",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ size }],
          logMessage:
            "signup.hydrateUserBag: singleton wire-bag requirement failed.",
          logLevel: "warn",
        });
        return;
      }

      const item = body.items[0] as BagItemWire | undefined;
      if (!item || typeof item !== "object") {
        this.failWithError({
          httpStatus: 400,
          title: "wire_bag_item_invalid",
          detail:
            "Wire bag item must be an object w/ type='user' + dto fields.",
          stage: "wire_bag.item_shape",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ itemType: typeof item }],
          logMessage: "signup.hydrateUserBag: invalid first item in wire bag.",
          logLevel: "warn",
        });
        return;
      }

      const itemType = (item as any).type;
      if (!itemType || itemType !== dtoType) {
        this.failWithError({
          httpStatus: 400,
          title: "wire_bag_type_mismatch",
          detail: `Wire bag item.type='${itemType}' mismatch dtoType='${dtoType}'.`,
          stage: "wire_bag.type",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ itemType, dtoType }],
          logMessage:
            "signup.hydrateUserBag: dtoType/type mismatch on inbound wire bag.",
          logLevel: "warn",
        });
        return;
      }

      // 2) Hydrate DTO + enforce id immutability
      try {
        const dto = UserDto.fromBody(item as Partial<UserJson>, {
          validate: true,
        });

        dto.setIdOnce(userId);

        const { bag } = BagBuilder.fromDtos([dto], {
          requestId,
          limit: 1,
          total: 1,
          cursor: null,
        });

        this.ctx.set("bag", bag);
        this.ctx.set("handlerStatus", "ok");

        const bagSize =
          typeof (bag as any).size === "function"
            ? (bag as any).size()
            : Array.from((bag as any).items?.() ?? []).length;

        this.log.debug(
          {
            event: "execute_exit",
            dtoType,
            requestId,
            bagSize,
          },
          "signup.hydrateUserBag: populated singleton bag w/ applied id"
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed UserDto hydration or id assignment.";

        this.failWithError({
          httpStatus: 400,
          title: "user_dto_validation_failed",
          detail: message,
          stage: "hydrate.userDto",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ dtoType, hasUserId: !!userId }],
          rawError: err,
          logMessage:
            "signup.hydrateUserBag: UserDto.fromBody()/setIdOnce() failed.",
          logLevel: "warn",
        });
      }
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_hydrate_user_bag_handler_failure",
        detail:
          "Unhandled exception while hydrating UserDto bag. Inspect logs/call stack.",
        stage: "execute.unhandled",
        requestId,
        origin: { file: __filename, method: "execute" },
        rawError: err,
        logMessage:
          "signup.hydrateUserBag: unhandled exception in hydrate handler.",
        logLevel: "error",
      });
    }

    this.log.debug(
      {
        event: "execute_end",
        handler: this.constructor.name,
        requestId,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "ok",
      },
      "signup.hydrateUserBag: exit handler"
    );
  }
}
