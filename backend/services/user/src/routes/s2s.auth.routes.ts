// backend/services/user/src/routes/s2s.auth.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - S2S-only endpoints invoked by the Auth service (wired to controllers):
 *   - PUT   /users            (create user; ONLY via Auth)
 *   - POST  /signon           (stub controller)
 *   - POST  /changepassword   (stub controller)
 *
 * Notes:
 * - These paths are **relative** to the mount point in app.ts:
 *     app.use(`/api/${svc}/v1`, userAuthRouter())
 *   So DO NOT include /v1 here.
 * - Pre-JWT guard: verifyTrustedCaller() enforces x-service-name ∈ S2S_ALLOWED_CALLERS.
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { UserCreateController } from "../controllers/user.create.controller";
import { UserSignonController } from "../controllers/user.signon.controller";
import { UserChangePasswordController } from "../controllers/user.changepassword.controller";

function getSvcName(): string {
  const n = process.env.SVC_NAME?.trim();
  if (!n) throw new Error("SVC_NAME is required but not set");
  return n;
}

function verifyTrustedCaller(req: Request, res: Response, next: NextFunction) {
  const allowedCsv = process.env.S2S_ALLOWED_CALLERS || "";
  const allowed = new Set(
    allowedCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const caller = (req.header("x-service-name") || "").trim();

  if (!caller || !allowed.has(caller)) {
    return res.status(403).json({
      ok: false,
      service: getSvcName(),
      data: {
        status: "forbidden",
        detail:
          "S2S caller not allowed. Set x-service-name and configure S2S_ALLOWED_CALLERS.",
      },
    });
  }
  return next();
}

export function userAuthRouter(): Router {
  const r = Router();

  // Enforce S2S-only access
  r.use(verifyTrustedCaller);

  // Wire controllers (no god-controllers)
  const create = new UserCreateController();
  const signon = new UserSignonController();
  const change = new UserChangePasswordController();

  // SOP: Create = PUT to plural resource
  r.put("/users", (req, res) => void create.handle(req, res));

  // Auth-driven ops
  r.post("/signon", (req, res) => void signon.handle(req, res));
  r.post("/changepassword", (req, res) => void change.handle(req, res));

  return r;
}
