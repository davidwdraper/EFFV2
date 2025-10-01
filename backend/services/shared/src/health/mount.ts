// backend/services/shared/src/health/mount.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 *
 * Purpose:
 * - Canonical, no-drift health mount helper for all services.
 * - Default base: /api/<service>/health → { /live, /ready }
 *
 * Usage:
 *   import { mountServiceHealth } from "@nv/shared/health/mount";
 *   mountServiceHealth(app, { service: "svcfacilitator" });
 */

import type { Express } from "express";
import { createHealthRouter } from "./Health";

export interface MountOpts {
  service: string; // e.g., "svcfacilitator"
  base?: string; // default: `/api/<service>/health`
}

export function mountServiceHealth(app: Express, opts: MountOpts): void {
  const base = opts.base ?? `/api/${opts.service}/health`;
  app.use(base, createHealthRouter({ service: opts.service }));
}
