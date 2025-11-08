// backend/services/user/src/routes/users.crud.routes.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - Wire CRUD endpoints (read/update/delete) to dedicated controllers.
 * - Paths here are relative to the /api/user/v1 mount in app.ts.
 *
 * Notes:
 * - CREATE is intentionally excluded (Auth-only via S2S).
 * - Routes are one-liners: import handlers only (no inline logic).
 * - Environment-invariant: slug fixed ("user"); no localhost/127.0.0.1.
 */

import { RouterBase } from "@nv/shared/base/RouterBase";
import { UserReadController } from "../controllers/user.read.controller";
import { UserUpdateController } from "../controllers/user.update.controller";
import { UserDeleteController } from "../controllers/user.delete.controller";

const SERVICE_SLUG = "user" as const;

export class UsersCrudRouter extends RouterBase {
  private readonly readCtrl = new UserReadController();
  private readonly updateCtrl = new UserUpdateController();
  private readonly deleteCtrl = new UserDeleteController();

  constructor() {
    super({ service: SERVICE_SLUG, context: { router: "UsersCrudRouter" } });
  }

  protected configure(): void {
    // READ: GET /users/:id
    this.get("/users/:id", this.readCtrl.read());

    // UPDATE: PATCH /users/:id
    this.patch("/users/:id", this.updateCtrl.update());

    // DELETE: DELETE /users/:id
    this.delete("/users/:id", this.deleteCtrl.remove());
  }
}
