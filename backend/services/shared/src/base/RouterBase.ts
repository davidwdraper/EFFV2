// backend/services/shared/src/base/RouterBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Logger with .bind())
 *
 * Purpose:
 * - Shared base class for Express routers.
 * - Provides `this.log`, `this.env`, and a consistent constructor pattern.
 * - Does *not* assume request auth or middleware — routers remain free to mount cleanly.
 *
 * Future use cases:
 * - Common metrics or middleware injection.
 * - Router-level timing or audit hooks.
 * - Default error wrapping for controller calls.
 */

import type { Router } from "express";
import { ServiceBase } from "./ServiceBase";

export abstract class RouterBase extends ServiceBase {
  /**
   * Must return a fully configured Express router ready to mount.
   */
  public abstract router(): Router;
}
