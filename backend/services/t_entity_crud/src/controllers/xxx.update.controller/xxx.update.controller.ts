// backend/services/t_entity_crud/src/controllers/xxx.update.controller/xxx.update.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; limit semantics)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *
 * Purpose:
 * - Orchestrate PATCH /api/xxx/v1/:id
 * - Pipeline (bag-first; mirrors create after consolidation):
 *     1) BagPopulateGetHandler (hydrate bag from body; requireSingleton; enforce meta.limit)
 *     2) LoadExistingUpdateHandler (read existing by ctx["id"] → ctx["existing"])
 *     3) ApplyPatchUpdateHandler (apply inbound DTO → produce UPDATED singleton bag)
 *     4) BagToDbUpdateHandler (build writer + update() + map dup-key → 409)
 *
 * Notes:
 * - Canonical path param is "id" (legacy :xxxId tolerated → normalized to ctx["id"]).
 * - DtoBag wrapper is enforced end-to-end; handlers read/write via ctx["bag"].
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Shared preflight
import { BagPopulateGetHandler } from "@nv/shared/http/handlers/bag.populate.get.handler";

// DTO ctor for downstream
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

// Update-specific handlers
import { LoadExistingUpdateHandler } from "./handlers/loadExisting.update.handler";
import { ApplyPatchUpdateHandler } from "./handlers/applyPatch.update.handler";
import { BagToDbUpdateHandler } from "./handlers/bagToDb.update.handler";

export class XxxUpdateController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async patch(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Seed DTO ctor for downstream handlers
    ctx.set("update.dtoCtor", XxxDto);

    // Normalize param to canonical "id" (stop xxxId drift)
    const idParam =
      (req.params as any)?.id ?? (req.params as any)?.xxxId ?? null;
    ctx.set("id", idParam);

    // Enforce singleton update and bind to meta.limit if present
    ctx.set("bagPolicy", {
      requireSingleton: true,
      enforceLimitFromMeta: true,
    });

    await this.runPipeline(
      ctx,
      [
        // 1) Hydrate DtoBag<IDto> from JSON body; enforce singleton; expose ctx["dto"]
        new BagPopulateGetHandler(ctx),
        // 2) Load the existing DTO that is to be patched
        new LoadExistingUpdateHandler(ctx),
        // 3) Apply patch using the inbound singleton bag; output UPDATED singleton bag
        new ApplyPatchUpdateHandler(ctx),
        // 4) Build writer + update() + 409 mapping
        new BagToDbUpdateHandler(ctx),
      ],
      {
        requireRegistry: true, // for BagPopulateGetHandler
      }
    );

    return super.finalize(ctx);
  }
}
