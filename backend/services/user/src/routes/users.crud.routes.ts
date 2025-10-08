// backend/services/user/src/routes/users.crud.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - Wire CRUD endpoints (read/update/delete) to dedicated controllers.
 * - Paths here are relative to the /api/<SVC_NAME>/v1 mount in app.ts.
 *
 * Notes:
 * - CREATE is intentionally excluded (Auth-only via S2S).
 * - Routes are one-liners: import handlers only (no inline logic).
 */
import { RouterBase } from "@nv/shared/base/RouterBase";
import { UserReadController } from "../controllers/user.read.controller";
import { UserUpdateController } from "../controllers/user.update.controller";
import { UserDeleteController } from "../controllers/user.delete.controller";

function getSvcName(): string {
  const n = process.env.SVC_NAME?.trim();
  if (!n) throw new Error("SVC_NAME is required but not set");
  return n;
}

export class UsersCrudRouter extends RouterBase {
  private readonly readCtrl = new UserReadController();
  private readonly updateCtrl = new UserUpdateController();
  private readonly deleteCtrl = new UserDeleteController();

  constructor() {
    super({ service: getSvcName(), context: { router: "UsersCrudRouter" } });
  }

  protected configure(): void {
    // READ: GET /users/:id
    this.r.get("/users/:id", this.readCtrl.read());

    // UPDATE: PATCH /users/:id
    this.r.patch("/users/:id", this.updateCtrl.update());

    // DELETE: DELETE /users/:id
    this.r.delete("/users/:id", this.deleteCtrl.remove());
  }
}
