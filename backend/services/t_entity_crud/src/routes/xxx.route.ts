// backend/services/t_entity_crud/src/routes/xxx.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Controller & Handler Architecture — per-route controllers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *
 * Purpose:
 * - Wire one specialized controller per route. No handlers yet.
 * - Controllers expose .handle() (ControllerBase.handle wrapper).
 *
 * Notes:
 * - Router builds controllers only. All other deps (db/fs/etc.) are created inside handlers later.
 * - Health is versioned; paths follow: /api/<slug>/v<major>/...
 */

import { RouterBase } from "@nv/shared/base/RouterBase";

// Route-specific controllers (to be implemented next)
import { XxxCreateController } from "../controllers/xxx.create.controller/xxx.create.controller";
import { XxxReadController } from "../controllers/xxx.read.controller";
import { XxxUpdateController } from "../controllers/xxx.update.controller";
import { XxxDeleteController } from "../controllers/xxx.delete.controller";
import { XxxListController } from "../controllers/xxx.list.controller";

export class XxxRouter extends RouterBase {
  protected configure(): void {
    // Instantiate one controller per route (no service deps here)
    const createCtl = new XxxCreateController();
    const readCtl = new XxxReadController();
    const updateCtl = new XxxUpdateController();
    const deleteCtl = new XxxDeleteController();
    const listCtl = new XxxListController();

    // Mount one-liners
    this.put("/api/xxx/v1/create", createCtl.handle());
    this.get("/api/xxx/v1/:xxxId", readCtl.handle());
    this.patch("/api/xxx/v1/:xxxId", updateCtl.handle());
    this.delete("/api/xxx/v1/:xxxId", deleteCtl.handle());
    this.get("/api/xxx/v1/list", listCtl.handle());
  }
}
