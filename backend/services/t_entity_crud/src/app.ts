// backend/services/t_entity_crud/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *
 * Purpose (template):
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Delegates heavy lifting to AppBase; mounts service routes as one-liners.
 *
 * Invariants:
 * - Health first (versioned), then reload endpoint, then policy/security/parsers/routes/post.
 * - No env reads here; env arrives via injected SvcEnvDto and is reloaded via AppBase.
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/AppBase";
import { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { buildXxxRouter } from "./routes/xxx.route";

type CreateAppOptions = {
  slug: string; // e.g., "xxx" (slug == API segment)
  version: number; // e.g., 1
  envDto: SvcEnvDto;
  /**
   * Supplies a fresh SvcEnvDto when /env/reload is called.
   * Must throw on failure (AppBase translates to 500).
   */
  envReloader: () => Promise<SvcEnvDto>;
};

/** Minimal template app class; add routes as one-liners in mountRoutes(). */
class XxxApp extends AppBase {
  constructor(opts: CreateAppOptions) {
    super({
      service: opts.slug, // ControllerBase expects this to match API slug segment
      version: opts.version,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
    });
  }

  // Service-specific routes — keep to one-liners that import real routers.
  protected override mountRoutes(): void {
    const base = this.healthBasePath(); // `/api/<slug>/v<version>`
    if (!base) {
      this.log.error({ reason: "no_base" }, "Failed to derive base path");
      throw new Error("Base path missing — check AppBase.healthBasePath()");
    }

    const r: Router = buildXxxRouter(this);
    this.app.use(base, r);
    this.log.info({ base }, "routes mounted");
  }
}

/**
 * Factory:
 * - Builds the app
 * - Boots it (ordered & synchronous)
 * - Returns { app: Express } for index.ts to .listen()
 */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new XxxApp(opts);
  await app.boot();
  return { app: app.instance };
}
