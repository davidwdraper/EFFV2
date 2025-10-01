// backend/services/svcfacilitator/src/controllers/HealthController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *
 * Purpose:
 * - Mount shared health endpoints for this service.
 */

import type { Express } from "express";
import { mountHealth } from "@nv/shared/src/health/Health";

export class HealthController {
  constructor(
    private readonly app: Express,
    private readonly service: string
  ) {}

  public mount(): void {
    mountHealth(this.app, { service: this.service });
  }
}
