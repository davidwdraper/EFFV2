// backend/services/svcfacilitator/src/routes/resolve.router.ts
/**
 * Docs:
 * - SOP: svcfacilitator is the source of truth; gateway mirrors from it.
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - Route layer for (slug, version) → baseUrl resolution, class-based.
 *
 * Contract:
 *   GET /api/svcfacilitator/v<major>/resolve?key=<slug@version>
 *   GET /api/svcfacilitator/v<major>/resolve/:slug/v:version
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { ResolveController } from "../controllers/ResolveController";

export class ResolveRouter extends RouterBase {
  private readonly ctrl = new ResolveController();

  protected configure(): void {
    // Accept ?key=<slug@version> (also leniently accept ?slug=)
    this.get("/resolve", this.resolveByKey);

    // Params variant: /resolve/:slug/v:version
    this.get("/resolve/:slug/v:version", this.resolveByParams);
  }

  private async resolveByKey(req: Request, res: Response): Promise<void> {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    const key =
      (req.query?.key as string | undefined)?.trim() ||
      (req.query?.slug as string | undefined)?.trim();

    if (!key) {
      this.jsonProblem(
        res,
        400,
        "invalid_request",
        "Missing ?key (or ?slug) query param"
      );
      return;
    }

    const requestId = (req.get("x-request-id") || "").trim();
    const data = await this.ctrl.resolveByKey({
      requestId,
      key,
      body: undefined,
    });

    this.jsonOk(res, data);
  }

  private async resolveByParams(req: Request, res: Response): Promise<void> {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    const slug = (req.params?.slug || "").trim();
    const version = (req.params?.version || "").trim();
    if (!slug || !version) {
      this.jsonProblem(
        res,
        400,
        "invalid_request",
        "Missing :slug or :version path params"
      );
      return;
    }

    const requestId = (req.get("x-request-id") || "").trim();
    const data = await this.ctrl.resolveByParams({
      requestId,
      slug,
      version,
      body: undefined,
    });

    this.jsonOk(res, data);
  }
}
