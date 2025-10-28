// backend/services/t_entity_crud/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose (template):
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Delegates heavy lifting to AppBase; mounts service routes as one-liners.
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/AppBase";
import { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { buildXxxRouter } from "./routes/xxx.route";
import { ensureIndexesForDtos } from "@nv/shared/dto/persistence/indexes/ensureIndexes";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";

type CreateAppOptions = {
  slug: string;
  version: number;
  envDto: SvcEnvDto;
  envReloader: () => Promise<SvcEnvDto>;
};

class XxxApp extends AppBase {
  constructor(opts: CreateAppOptions) {
    // IMPORTANT: logger requires SvcEnv **before** any logging occurs
    setLoggerEnv(opts.envDto);

    super({
      service: opts.slug,
      version: opts.version,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
    });
  }

  /** Boot-time: ensure indexes deterministically; hints are burned after read. */
  protected override async onBoot(): Promise<void> {
    await ensureIndexesForDtos({
      dtos: [XxxDto],
      svcEnv: this.svcEnv, // ADR-0044 accessor
      log: this.log,
    });
  }

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

export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new XxxApp(opts);
  await app.boot();
  return { app: app.instance };
}
