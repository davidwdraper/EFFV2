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
 *   - ADR-0101 (Universal seeder + seeder→handler pairs)
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *
 * Purpose:
 * - Orchestrate:
 *     PUT /api/auth/v1/:dtoType/signup
 *
 * Ladder rule:
 * - Pipeline is being refactored rung-by-rung; controller must execute seeder→handler pairs.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { DbUserDto } from "@nv/shared/dto/db.user.dto";

import { resolveSeederCtor } from "@nv/shared/http/handlers/seeding/seederRegistry";

import { UserSignupPL } from "./pipelines/signup.handlerPipeline/UserSignupPL";

type WireBagBody = { items?: unknown[]; meta?: unknown };

export class AuthSignupController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const routeDtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);

    // ADR-0103: canonical identity is registry key (not route param)
    // Route param remains for URL stability; we map it to a key here.
    const dtoKey = routeDtoType === "user" ? "db.user.dto" : routeDtoType;

    ctx.set("dtoKey", dtoKey);
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
    // Controller prelude: hydrate + guard inbound DTO bag (ADR-0097 + ADR-0102)
    // - Signup REQUIRES a valid wire bag with exactly one item.
    // - Hydration MUST happen via the app registry (no local registry instances).
    // - DTO ctor hydration MUST self-enforce _id UUIDv4 and throw if missing/invalid.
    // - Controller MUST catch hydration throws and respond immediately with 400.
    // ───────────────────────────────────────────
    if (dtoKey !== "db.user.dto") {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 501);
      ctx.set("response.body", {
        code: "NOT_IMPLEMENTED",
        title: "Not Implemented",
        detail: `No signup pipeline for dtoType='${routeDtoType}' on auth service.`,
        requestId,
      });
      return super.finalize(ctx);
    }

    if (!ctx.has("body")) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 400);
      ctx.set("response.body", {
        title: "wire_bag_missing",
        detail: "Signup requires a JSON wire bag envelope with items[].",
        requestId,
      });
      return super.finalize(ctx);
    }

    const body = ctx.get<WireBagBody>("body");
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

    try {
      const reg = this.getDtoRegistry();
      const dto = reg.create<DbUserDto>("db.user.dto", item, {
        validate: true,
      });

      // Explicit allow-list: auth signup supports DbUserDto only.
      // Guard on class + dtoKey (registry key is canonical).
      if (!(dto instanceof DbUserDto)) {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 400);
        ctx.set("response.body", {
          title: "dto_type_not_allowed",
          detail: "Hydrated DTO is not allowed for auth signup.",
          requestId,
        });
        return super.finalize(ctx);
      }

      ctx.set("bag", new DtoBag<DbUserDto>([dto]));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to hydrate and validate inbound DbUserDto.";
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 400);
      ctx.set("response.body", {
        title: "user_dto_validation_failed",
        detail: message,
        requestId,
      });
      return super.finalize(ctx);
    }

    const pl = new UserSignupPL();
    const pipelineName = pl.pipelineName();

    this.log.pipeline(
      {
        event: "pipeline_select",
        op: "signup",
        dtoType: dtoKey,
        requestId,
        pipeline: pipelineName,
      },
      "auth.signup: selecting signup pipeline"
    );

    const stepDefs = pl.getStepDefs("live");

    this.log.pipeline(
      {
        event: "pipeline_start",
        op: "signup",
        dtoType: dtoKey,
        requestId,
        pipeline: pipelineName,
        steps: stepDefs.map((d: any) => ({
          seed:
            typeof d?.seedName === "string" && d.seedName.trim()
              ? d.seedName.trim()
              : "noop",
          handler: String(d?.handlerName ?? ""),
        })),
      },
      "auth.signup: pipeline starting"
    );

    for (const d of stepDefs as any[]) {
      const seedName =
        typeof d?.seedName === "string" && d.seedName.trim()
          ? d.seedName.trim()
          : "noop";

      const seedSpec =
        d && typeof d?.seedSpec === "object" && d.seedSpec !== null
          ? d.seedSpec
          : {};

      // 1) seed
      const SeederCtor = (d?.seederCtor ?? resolveSeederCtor(seedName)) as any;
      const seeder = new SeederCtor(ctx, this, seedSpec);
      await seeder.run();

      if (ctx.get("handlerStatus") === "error") break;

      // 2) handler
      const h = new d.handlerCtor(ctx, this, d.handlerInit);
      await h.run();

      if (ctx.get("handlerStatus") === "error") break;
    }

    const handlerStatus = ctx.get("handlerStatus") ?? "success";

    this.log.pipeline(
      {
        event: "pipeline_complete",
        op: "signup",
        dtoType: dtoKey,
        requestId,
        pipeline: pipelineName,
        handlerStatus,
      },
      "auth.signup: pipeline complete"
    );

    return super.finalize(ctx);
  }
}
