// backend/services/svcfacilitator/src/routes/resolve.router.ts
/**
 * Routes:
 *   GET /api/svcfacilitator/v1/resolve?slug=<slug>&version=<ver>
 *   GET /api/svcfacilitator/v1/resolve?key=<slug@ver>
 *   GET /api/svcfacilitator/v1/resolve/:slug/v:version
 *
 * Returns (via RouterBase.jsonOk):
 *   { ok: true, data: { slug, version, baseUrl, outboundApiPrefix, etag } }
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
// IMPORTANT: match the actual filename you just created
import { ResolveController } from "../controllers/ResolveController";

export class ResolveRouter extends RouterBase {
  private readonly ctrl = new ResolveController();

  protected configure(): void {
    this.get("/resolve", this.resolveQuery);
    this.get("/resolve/:slug/v:version", this.resolveParams);
  }

  private resolveQuery = async (req: Request, res: Response) => {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    const slug = (req.query.slug as string | undefined)?.trim();
    const version = (req.query.version as string | undefined)?.trim();
    const key = (req.query.key as string | undefined)?.trim();

    try {
      const payload =
        key != null && key !== ""
          ? await this.ctrl.resolveByKey({ body: undefined, key })
          : await this.ctrl.resolveByParams({
              body: undefined,
              slug: slug ?? "",
              version: version ?? "",
            });

      // payload already is { slug, version, baseUrl, outboundApiPrefix, etag }
      this.jsonOk(res, payload);
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      this.jsonProblem(
        res,
        status,
        err?.code || "error",
        err?.message || "error"
      );
    }
  };

  private resolveParams = async (req: Request, res: Response) => {
    if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

    try {
      const payload = await this.ctrl.resolveByParams({
        body: undefined,
        slug: (req.params.slug || "").trim(),
        version: (req.params.version || "").trim(),
      });

      this.jsonOk(res, payload);
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      this.jsonProblem(
        res,
        status,
        err?.code || "error",
        err?.message || "error"
      );
    }
  };
}
