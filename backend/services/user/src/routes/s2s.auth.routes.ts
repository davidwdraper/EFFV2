// backend/services/user/src/routes/s2s.auth.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0021-user-opaque-password-hash
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - S2S-only endpoints invoked by the Auth service:
 *   - PUT    /create
 *   - POST   /signon          (stub)
 *   - POST   /changepassword  (stub)
 *   - DELETE /delete/:id      (idempotent delete-by-id; ack for smoke #8)
 *
 * Notes:
 * - Mounted under /api/<svc>/v1 in app.ts (do not repeat /v1 here).
 * - Header-only S2S guard for now: verifyTrustedCaller() (x-service-name allowlist).
 */

import type { RequestHandler } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { UserCreateController } from "../controllers/user.create.controller";
import { UserSignonController } from "../controllers/user.signon.controller";
import { UserChangePasswordController } from "../controllers/user.changepassword.controller";
import { UserDeleteController } from "../controllers/user.delete.controller";

function getSvcName(): string {
  const n = process.env.SVC_NAME?.trim();
  if (!n) throw new Error("SVC_NAME is required but not set");
  return n;
}

/** Header-only S2S guard — MUST be a RequestHandler (void return). */
const verifyTrustedCaller: RequestHandler = (req, res, next) => {
  const allowedCsv = process.env.S2S_ALLOWED_CALLERS || "";
  const allowed = new Set(
    allowedCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const caller = String(req.header("x-service-name") || "").trim();
  if (!caller || !allowed.has(caller)) {
    res.status(403).json({
      ok: false,
      service: getSvcName(),
      data: {
        status: "forbidden",
        detail:
          "S2S caller not allowed. Set x-service-name and configure S2S_ALLOWED_CALLERS.",
      },
    });
    return;
  }
  next();
};

export class UserS2SRouter extends RouterBase {
  private readonly createCtrl = new UserCreateController();
  private readonly signonCtrl = new UserSignonController();
  private readonly changeCtrl = new UserChangePasswordController();
  private readonly deleteCtrl = new UserDeleteController();

  constructor() {
    super({ service: getSvcName(), context: { router: "UserS2SRouter" } });
  }

  protected configure(): void {
    // Guard first — does NOT consume body
    this.r.use(verifyTrustedCaller);

    // Create user (S2S-only)
    this.r.put("/create", this.createCtrl.create());

    // Signon stub
    this.r.post(
      "/signon",
      this.signonCtrl.handle(async () => ({
        status: 501,
        body: { ok: false, error: "not_implemented" },
      }))
    );

    // Change password stub
    this.r.post(
      "/changepassword",
      this.changeCtrl.handle(async () => ({
        status: 501,
        body: { ok: false, error: "not_implemented" },
      }))
    );

    // Delete by id (S2S-only, idempotent ack) for smoke #8
    this.r.delete("/delete/:id", this.deleteCtrl.s2sDeleteById());
  }
}
