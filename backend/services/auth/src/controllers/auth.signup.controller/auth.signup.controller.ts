// backend/services/auth/src/controllers/auth.signup.controller/auth.signup.controller.ts
/**
 * Docs:
 * - SOP: DTO-first; controller orchestrates, handlers do the work
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *   - ADR-0097 (Controller bag hydration + type guarding)
 *   - ADR-0098 (Domain-named pipelines with PL suffix)
 *   - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 *
 * Purpose:
 * - Orchestrate:
 *     PUT /api/auth/v1/:dtoType/signup
 * - For now, only dtoType="user" is supported.
 *
 * Invariants:
 * - Edge payload is a wire bag envelope: { items: [ { type:"user", ... } ], meta?: {...} }.
 * - Controller hydrates and type-guards inbound DTOs, then seeds ctx["bag"].
 * - Controller seeds S2S routing metadata (slug/version) required by downstream MOS handlers.
 * - Pipelines start from a contract-valid ctx["bag"] (or no bag if body is absent).
 * - Controller stays thin: input normalization + orchestration + finalize.
 *
 * ADR-0100 note:
 * - Pipeline planning is pure (ctor refs only).
 * - Controller instantiates handler instances for live execution.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { UserDto } from "@nv/shared/dto/user.dto";
import { UserDtoRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";

import { UserSignupPL } from "./pipelines/signup.handlerPipeline/UserSignupPL";

type WireBagBody = { items?: unknown[]; meta?: unknown };

export class AuthSignupController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "signup");

    const requestId = ctx.get<string>("requestId");

    // ───────────────────────────────────────────
    // Controller-owned S2S routing metadata (MOS orchestration concern)
    // ───────────────────────────────────────────
    ctx.set("s2s.slug.user", "user");
    ctx.set("s2s.version.user", 1);

    ctx.set("s2s.slug.userAuth", "user-auth");
    ctx.set("s2s.version.userAuth", 1);

    // ───────────────────────────────────────────
    // Controller prelude: hydrate + guard inbound DTO bag (ADR-0097)
    // ───────────────────────────────────────────
    if (ctx.has("body")) {
      const body = ctx.get<WireBagBody>("body");

      // Body may be present but empty/undefined depending on middleware; treat falsy as "no body".
      if (body) {
        const items = (body as any)?.items;

        if (!Array.isArray(items)) {
          ctx.set("handlerStatus", "error");
          ctx.set("response.status", 400);
          ctx.set("response.body", {
            title: "wire_bag_invalid",
            detail: "Expected a wire bag envelope with items[].",
            requestId,
          });
          return super.finalize(ctx);
        }

        if (items.length !== 1) {
          ctx.set("handlerStatus", "error");
          ctx.set("response.status", 400);
          ctx.set("response.body", {
            title:
              items.length === 0 ? "wire_bag_empty" : "wire_bag_too_many_items",
            detail:
              items.length === 0
                ? "Signup requires exactly one item; received 0."
                : `Signup requires exactly one item; received ${items.length}.`,
            requestId,
          });
          return super.finalize(ctx);
        }

        const item = items[0];
        if (!item || typeof item !== "object") {
          ctx.set("handlerStatus", "error");
          ctx.set("response.status", 400);
          ctx.set("response.body", {
            title: "wire_bag_item_invalid",
            detail: "Wire bag item must be an object.",
            requestId,
          });
          return super.finalize(ctx);
        }

        // Route-bound controller chooses the appropriate registry.
        // Guarding is performed AFTER hydration (ADR-0097).
        try {
          if (dtoType !== "user") {
            ctx.set("handlerStatus", "error");
            ctx.set("response.status", 501);
            ctx.set("response.body", {
              code: "NOT_IMPLEMENTED",
              title: "Not Implemented",
              detail: `No signup pipeline for dtoType='${dtoType}' on auth service.`,
              requestId,
            });
            return super.finalize(ctx);
          }

          const reg = new UserDtoRegistry();
          const dto = reg.fromJsonUser(item, { validate: true });

          const hydratedType =
            typeof (dto as any)?.getType === "function"
              ? String((dto as any).getType())
              : "unknown";

          if (!(dto instanceof UserDto) || hydratedType !== "user") {
            ctx.set("handlerStatus", "error");
            ctx.set("response.status", 400);
            ctx.set("response.body", {
              title: "dto_type_not_allowed",
              detail: `Hydrated DTO type='${hydratedType}' is not allowed for auth signup.`,
              requestId,
            });
            return super.finalize(ctx);
          }

          ctx.set("bag", new DtoBag<UserDto>([dto]));
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to hydrate and validate inbound UserDto.";
          ctx.set("handlerStatus", "error");
          ctx.set("response.status", 400);
          ctx.set("response.body", {
            title: "user_dto_validation_failed",
            detail: message,
            requestId,
          });
          return super.finalize(ctx);
        }
      }
    }

    // Instantiate the domain pipeline (planning only; PURE).
    const pl = new UserSignupPL();
    const pipelineName = pl.pipelineName();

    // High-level pipeline selection trace (PIPELINE level)
    this.log.pipeline(
      {
        event: "pipeline_select",
        op: "signup",
        dtoType,
        requestId,
        pipeline: pipelineName,
      },
      "auth.signup: selecting signup pipeline"
    );

    switch (dtoType) {
      case "user": {
        // ADR-0100: plan-first (ctor refs), then instantiate for live execution.
        const stepDefs = pl.getStepDefs("live");
        const steps = stepDefs.map((d) => new d.handlerCtor(ctx, this));

        // Pipeline start: log handler list in execution order
        this.log.pipeline(
          {
            event: "pipeline_start",
            op: "signup",
            dtoType,
            requestId,
            pipeline: pipelineName,
            handlers: steps.map((h: any) =>
              typeof h?.getHandlerName === "function"
                ? String(h.getHandlerName())
                : String(h?.constructor?.name ?? "unknown")
            ),
          },
          "auth.signup: pipeline starting"
        );

        // Auth is MOS: do NOT require a DTO registry during preflight.
        await this.runPipeline(ctx, steps, {
          requireRegistry: false,
        });

        // Pipeline completion trace with final handlerStatus
        const handlerStatus = ctx.get("handlerStatus") ?? "success";

        this.log.pipeline(
          {
            event: "pipeline_complete",
            op: "signup",
            dtoType,
            requestId,
            pipeline: pipelineName,
            handlerStatus,
          },
          "auth.signup: pipeline complete"
        );

        break;
      }

      default: {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No signup pipeline for dtoType='${dtoType}' on auth service.`,
          requestId: ctx.get("requestId"),
        });

        this.log.warn(
          {
            event: "pipeline_missing",
            op: "signup",
            dtoType,
            requestId,
          },
          "auth.signup: no signup pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
