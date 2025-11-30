// backend/services/auth/src/controllers/auth.create.controller/createAuthDto.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric edges
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; edge → DTO)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *   - ADR-0053 (Instantiation Discipline via Registry Secret)
 *
 * Purpose:
 * - Validate the inbound wire bag envelope for auth.create.
 * - Hydrate a single AuthDto instance **via the Registry**, never via direct ctor/fromBody.
 * - Store the hydrated DTO on the bus for downstream handlers.
 *
 * Inputs (ctx):
 * - "body": {
 *     items: [ { type: string, item?: unknown, ...dtoFields } ],
 *     meta?: object
 *   }
 * - "dtoType": string (expected to be "auth" for this pipeline)
 *
 * Outputs (ctx):
 * - "authDto": IDto (AuthDto at runtime, created via Registry.fromWireItem)
 * - "handlerStatus": "ok" on success
 *
 * Error (ctx):
 * - "handlerStatus": "error"
 * - "response.status": 4xx
 * - "response.body": ProblemDetails-like object
 *
 * Invariants:
 * - Requires exactly one item in body.items.
 * - item.type must match ctx["dtoType"].
 * - DTO is always instantiated via the service Registry (enforces DtoBase secret).
 * - No wire payloads are built here; this is purely DTO hydration.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type {
  IDtoRegistry,
  BagItemWire,
} from "@nv/shared/registry/RegistryBase";

export class CreateAuthDtoHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug(
      { event: "execute_enter" },
      "auth.createAuthDto: enter handler"
    );

    const dtoType = this.ctx.get<string>("dtoType");
    const body = this.ctx.get<any>("body");

    if (!body || !Array.isArray(body.items)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "WIRE_BAG_INVALID",
        title: "Bad Request",
        detail:
          "Expected a wire bag envelope with 'items: []'. Dev: ensure edge sends { items: [ { type, ... } ] }.",
        requestId: this.ctx.get("requestId"),
      });

      this.log.warn(
        {
          event: "wire_bag_invalid",
          bodyType: typeof body,
          hasItems: !!body?.items,
        },
        "auth.createAuthDto: missing or invalid items[] on inbound payload"
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
            ? "Create requires exactly one item in the wire bag; received 0."
            : `Create requires exactly one item in the wire bag; received ${size}.`,
        requestId: this.ctx.get("requestId"),
      });

      this.log.warn(
        {
          event: "wire_bag_wrong_size",
          size,
        },
        "auth.createAuthDto: singleton requirement failed"
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
          "Wire bag item must be an object with type and DTO fields. Dev: ensure items[0] is a DTO-like object.",
        requestId: this.ctx.get("requestId"),
      });

      this.log.warn(
        {
          event: "wire_bag_item_invalid",
          itemType: typeof item,
        },
        "auth.createAuthDto: invalid first item in wire bag"
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
        detail: `Wire bag item.type='${itemType}' does not match expected dtoType='${dtoType}'. Dev: align route dtoType and item.type.`,
        requestId: this.ctx.get("requestId"),
      });

      this.log.warn(
        {
          event: "wire_bag_type_mismatch",
          itemType,
          dtoType,
        },
        "auth.createAuthDto: dtoType/type mismatch"
      );
      return;
    }

    // ───── Registry-based instantiation (no direct DTO.fromBody) ─────
    const registry = (this.controller as any).registry as
      | IDtoRegistry
      | undefined;

    if (!registry || typeof registry.fromWireItem !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "REGISTRY_MISSING",
        title: "Internal Error",
        detail:
          "Auth DTO registry is not available on the controller. Dev: ensure ControllerBase/app wires a per-service Registry instance.",
        requestId: this.ctx.get("requestId"),
      });

      this.log.error(
        {
          event: "registry_missing",
          handler: this.constructor.name,
        },
        "auth.createAuthDto: controller.registry is missing or invalid"
      );
      return;
    }

    try {
      // All instantiation discipline enforced inside Registry/DtoBase.
      const dto = registry.fromWireItem(item, { validate: true });

      this.ctx.set("authDto", dto);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "execute_exit",
          dtoType,
          id: (dto as any)?.getId?.(),
        },
        "auth.createAuthDto: AuthDto (via Registry) hydrated successfully"
      );
    } catch (err) {
      const message =
        (err as Error)?.message ??
        "Failed to hydrate AuthDto from inbound payload via Registry.";

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "AUTH_DTO_VALIDATION_FAILED",
        title: "Bad Request",
        detail: message,
        requestId: this.ctx.get("requestId"),
      });

      this.log.warn(
        {
          event: "auth_dto_validation_failed",
          error: message,
        },
        "auth.createAuthDto: Registry.fromWireItem() validation failed"
      );
    }
  }
}
