// backend/services/auth/src/controllers/auth.create.controller/handlers/auth.toUser.mapper.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *
 * Purpose:
 * - In the Auth service, map an inbound AuthDto (singleton bag) to a UserDto,
 *   using the DTO registry, so the resulting UserDto bag can be passed along
 *   to downstream handlers and eventually sent to the User service via SvcClient.
 *
 * Pattern:
 * - This handler **replaces** ctx["bag"] with a DtoBag<UserDto> so the
 *   handler→handler pattern of a standard DtoBag on ctx["bag"] is preserved.
 * - The original AuthDto bag is preserved on ctx["auth.bag"] for diagnostics.
 *
 * Inputs (ctx):
 * - "bag": DtoBag<AuthDto> (singleton)
 *
 * Outputs (ctx):
 * - "auth.bag": DtoBag<AuthDto> (original)
 * - "bag": DtoBag<UserDto> (singleton; becomes the new bag on the bus)
 * - "dtoType": "user" (overwritten so downstream handlers see the correct type)
 * - "handlerStatus": "ok" | "error"
 * - On error only:
 *   - "response.status": number
 *   - "response.body": ProblemDetails-like object
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { AuthDto } from "@nv/shared/dto/auth.dto";
import type { UserDto, UserJson } from "@nv/shared/dto/user.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";

export class AuthToUserDtoMapperHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const rawRequestId = this.ctx.get("requestId");
    const requestId =
      typeof rawRequestId === "string" && rawRequestId.trim().length > 0
        ? rawRequestId.trim()
        : "unknown";

    const authBag = this.ctx.get<DtoBag<AuthDto>>("bag");
    if (!authBag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "AUTH_BAG_MISSING",
        title: "Internal Error",
        detail:
          "AuthToUserDtoMapperHandler expected ctx['bag'] to contain a DtoBag<AuthDto>, but it was missing. Dev: ensure upstream BagPopulate handler ran successfully.",
        requestId,
      });
      this.log.error(
        { event: "auth_bag_missing", handler: this.constructor.name },
        "AuthToUserDtoMapperHandler aborted — no auth bag on ctx['bag']"
      );
      return;
    }

    const authItems = Array.from(authBag.items());
    if (authItems.length !== 1) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code:
          authItems.length === 0 ? "AUTH_BAG_EMPTY" : "AUTH_BAG_TOO_MANY_ITEMS",
        title: "Bad Request",
        detail:
          authItems.length === 0
            ? "Auth create requires exactly one AuthDto in the bag; received 0."
            : `Auth create requires exactly one AuthDto in the bag; received ${authItems.length}.`,
        requestId,
      });
      this.log.warn(
        {
          event: "auth_bag_size_invalid",
          count: authItems.length,
          handler: this.constructor.name,
        },
        "AuthToUserDtoMapperHandler — singleton requirement failed"
      );
      return;
    }

    const authDto = authItems[0] as AuthDto;

    // Resolve the UserDto ctor via the registry
    const registry: IDtoRegistry = this.controller.getDtoRegistry();
    let userCtor: {
      fromBody(json: Partial<UserJson>, opts?: { validate?: boolean }): UserDto;
    };

    try {
      userCtor = registry.resolveCtorByType("user") as typeof UserDto;
    } catch (err) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "USER_DTOTYPE_NOT_REGISTERED",
        title: "Internal Error",
        detail:
          "DTO registry does not have a 'user' entry. Ops: ensure the UserDto is registered with dtoType='user' in the shared registry before wiring Auth→User flows.",
        requestId,
      });
      this.log.error(
        {
          event: "user_dto_registry_missing",
          err: (err as Error)?.message,
        },
        "AuthToUserDtoMapperHandler aborted — dtoType 'user' not registered"
      );
      return;
    }

    // Build the UserJson payload from AuthDto (1:1 mapping on shared fields)
    const userJson: Partial<UserJson> = {
      givenName: authDto.givenName,
      lastName: authDto.lastName,
      email: authDto.email,
      phone: authDto.phone,
      homeLat: authDto.homeLat,
      homeLng: authDto.homeLng,
      // Address / notes intentionally left undefined at create time.
    };

    const userDto = userCtor.fromBody(userJson, { validate: false });

    // Build a DtoBag<UserDto> that becomes the new ctx["bag"]
    const { bag: userBag } = BagBuilder.fromDtos([userDto], {
      requestId,
      limit: 1,
      total: 1,
      cursor: null,
    });

    // Preserve the original Auth bag for diagnostics, but move the bus forward
    // with the UserDto bag as the canonical ctx["bag"].
    this.ctx.set("auth.bag", authBag);
    this.ctx.set("bag", userBag);
    this.ctx.set("dtoType", "user"); // downstream handlers now see the correct type
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "auth_to_user_mapped",
        requestId,
        userEmail: userDto.email,
      },
      "AuthToUserDtoMapperHandler — replaced ctx['bag'] with UserDto bag"
    );
  }
}
