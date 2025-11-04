/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Orchestrate PUT /api/xxx/v1/create (mounted at /create relative to base).
 * - No business logic; seeds ctx → shared bag-populate → bag→dto require-singleton → writer prep → write → finalize.
 *
 * Invariants:
 * - Edges are bag-only (payload { items:[{type:"xxx", ...}] } ).
 * - Create requires exactly 1 DTO item; fail fast otherwise.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { BagPopulateGetHandler } from "@nv/shared/http/handlers/bag.populate.get.handler";
import { BagRequireSingletonCreateHandler } from "./handlers/bagRequireSingleton.create.handler";
import { DtoToDbCreateHandler } from "./handlers/bagToDb.create.handler";
import { DbWriteCreateHandler } from "./handlers/dbWrite.create.handler";

export class XxxCreateController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    await this.runPipeline(
      ctx,
      [
        // 1) Hydrate a DtoBag<IDto> from the JSON body (shared handler)
        new BagPopulateGetHandler(ctx),
        // 2) Enforce single-item create and expose ctx.set("dto", <XxxDto>)
        new BagRequireSingletonCreateHandler(ctx),
        // 3) Prepare DbWriter with svcEnv + dto (no write yet)
        new DtoToDbCreateHandler(ctx),
        // 4) Perform the insert; map dup-key → 409
        new DbWriteCreateHandler(ctx),
      ],
      {
        // Create needs the registry (BagPopulateGetHandler consumes it from App)
        requireRegistry: true,
      }
    );

    return super.finalize(ctx);
  }
}
