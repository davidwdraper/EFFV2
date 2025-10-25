// backend/services/svcfacilitator/src/routes/resolve.router.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/routes/resolve.router.v2.ts
 *
 * Design / SOP:
 * - Routes are one-liners; no business logic.
 * - Always respond with JSON (success or error). Do not fall through to Express HTML.
 * - Supported forms:
 *    GET /api/svcfacilitator/v1/resolve?key=<slug@version>
 *    GET /api/svcfacilitator/v1/resolve?slug=<slug>&version=<ver>
 *    GET /api/svcfacilitator/v1/resolve/:slug/v:version
 *
 * Why:
 * - Environment invariance + audit readiness: consistent JSON envelope at the edge.
 * - Router self-seals with a catch-all JSON 404 to avoid Express HTML even if mount order/base path is wrong.
 */

import { Router, Response } from "express";
import { ResolveController } from "../controllers/ResolveController.v2";

/** Minimal RFC7807-ish JSON error */
function sendProblem(
  res: Response,
  status: number,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>
) {
  res
    .status(status)
    .set("Content-Type", "application/problem+json; charset=utf-8")
    .json({
      type: "about:blank",
      title,
      status,
      detail,
      ...extra,
    });
}

function tryJson<T>(
  res: Response,
  work: () => Promise<T>,
  onOk: (val: T) => void
) {
  return work()
    .then(onOk)
    .catch((err: any) => {
      // Coerce status: prefer numeric err.status; fall back to numeric err.code; else 500
      const status =
        (Number.isFinite(err?.status) && Number(err.status)) ||
        (Number.isFinite(err?.code) && Number(err.code)) ||
        500;
      const title =
        (typeof err?.title === "string" && err.title) ||
        "resolve_request_failed";
      const detail = String(err?.message ?? err);
      sendProblem(res, status, title, detail);
    });
}

export class ResolveRouterV2 {
  private readonly r: Router;

  constructor(private readonly ctrl: ResolveController) {
    this.r = Router();

    // /resolve?key=<slug@version> OR /resolve?slug=<slug>&version=<ver>
    this.r.get("/resolve", (req, res) => {
      const key = (req.query.key as string | undefined)?.trim();
      const slug = (req.query.slug as string | undefined)?.trim();
      const versionRaw = (req.query.version as string | undefined)?.trim();

      if (key) {
        return tryJson(
          res,
          () => this.ctrl.resolveByKey({ body: undefined, key }),
          (out) =>
            res
              .status(200)
              .set("Content-Type", "application/json; charset=utf-8")
              .json(out)
        );
      }

      if (slug && versionRaw) {
        return tryJson(
          res,
          () =>
            this.ctrl.resolveByParams({
              body: undefined,
              slug,
              version: versionRaw, // controller expects string
            }),
          (out) =>
            res
              .status(200)
              .set("Content-Type", "application/json; charset=utf-8")
              .json(out)
        );
      }

      return sendProblem(
        res,
        400,
        "resolve_bad_params",
        "expected ?key=<slug@version> or ?slug=<slug>&version=<int>"
      );
    });

    // /resolve/:slug/v:version
    this.r.get("/resolve/:slug/v:version", (req, res) => {
      const slug = req.params.slug;
      const versionRaw = req.params.version; // keep as string for controller
      if (!slug || !versionRaw) {
        return sendProblem(
          res,
          400,
          "resolve_bad_params",
          "expected /resolve/:slug/v:version"
        );
      }

      return tryJson(
        res,
        () =>
          this.ctrl.resolveByParams({
            body: undefined,
            slug,
            version: versionRaw,
          }),
        (out) =>
          res
            .status(200)
            .set("Content-Type", "application/json; charset=utf-8")
            .json(out)
      );
    });

    // ---- SELF-SEALING JSON 404 (router-level) ----
    // If anything under /resolve* doesn't match above routes, return problem+json,
    // preventing Express' default HTML 404 from ever reaching the client.
    this.r.use("/resolve", (req, res) =>
      sendProblem(res, 404, "not_found", "No resolve route matched")
    );
  }

  router(): Router {
    return this.r;
  }
}

export default ResolveRouterV2;
