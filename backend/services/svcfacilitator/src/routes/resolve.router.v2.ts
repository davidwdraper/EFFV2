// backend/services/svcfacilitator/src/routes/resolve.router.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/routes/resolve.router.v2.ts
 *
 * Routes:
 *   GET /api/svcfacilitator/v1/resolve?slug=<slug>&version=<ver>
 *   GET /api/svcfacilitator/v1/resolve?key=<slug@ver>
 *   GET /api/svcfacilitator/v1/resolve/:slug/v:version
 *
 * Contract (RouterBase.jsonOk):
 *   MirrorEntryV2 (combined parent + policies):
 *   {
 *     serviceConfig: {
 *       _id: string,
 *       slug: string,
 *       version: number,
 *       enabled: boolean,
 *       updatedAt: string,
 *       updatedBy: string,
 *       notes?: string
 *     },
 *     policies: {
 *       edge: EdgeRoutePolicyDoc[],
 *       s2s:  S2SRoutePolicyDoc[]
 *     }
 *   }
 *
 * Invariants:
 * - Router is glue-only: versioned path guard, call controller, return JSON.
 * - No env reads. No data reshaping (controller returns contract-ready body).
 * - One-liners; DI for controller.
 */

import type { Request, Response } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { ResolveController } from "../controllers/ResolveController.v2";

export class ResolveRouterV2 extends RouterBase {
  constructor(private readonly ctrl: ResolveController) {
    super();
  }

  protected configure(): void {
    this.get("/resolve", (req: Request, res: Response) => {
      if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

      const slug = (req.query.slug as string | undefined)?.trim();
      const version = (req.query.version as string | undefined)?.trim();
      const key = (req.query.key as string | undefined)?.trim();

      void (async () => {
        try {
          const result =
            key != null && key !== ""
              ? await this.ctrl.resolveByKey({ body: undefined, key })
              : await this.ctrl.resolveByParams({
                  body: undefined,
                  slug: slug ?? "",
                  version: version ?? "",
                });

          const body = unwrapControllerResult(result);
          this.jsonOk(res, body);
        } catch (err: any) {
          this.jsonProblem(
            res,
            asInt(err?.status, 500),
            err?.code || "error",
            err?.message || "error"
          );
        }
      })();
    });

    this.get("/resolve/:slug/v:version", (req: Request, res: Response) => {
      if (!this.requireVersionedApiPath(req, res, "svcfacilitator")) return;

      void (async () => {
        try {
          const result = await this.ctrl.resolveByParams({
            body: undefined,
            slug: (req.params.slug || "").trim(),
            version: (req.params.version || "").trim(),
          });

          const body = unwrapControllerResult(result);
          this.jsonOk(res, body);
        } catch (err: any) {
          this.jsonProblem(
            res,
            asInt(err?.status, 500),
            err?.code || "error",
            err?.message || "error"
          );
        }
      })();
    });
  }
}

// ── Unwraps ControllerBase HandlerResult variants (no reshaping) ────────────

function unwrapControllerResult(input: any): any {
  if (input && typeof input === "object") {
    if (typeof input.status === "number") {
      if (input.body && typeof input.body === "object") return input.body;
      if (input.data && typeof input.data === "object") return input.data;
    }
    if (input.ok === true && input.data && typeof input.data === "object") {
      return input.data;
    }
  }
  // If controller returned a plain object already, pass through
  if (input && typeof input === "object") return input;

  const err: any = new Error(
    "resolve_contract_violation: unable to unwrap controller result"
  );
  err.status = 500;
  err.code = "resolve_contract_violation";
  throw err;
}

function asInt(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? n : fallback;
}
