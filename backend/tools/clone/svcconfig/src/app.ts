// backend/services/svcconfig/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose (template):
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 * - Ensures Mongo indexes are created at boot (before any routes are mounted).
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/AppBase";
import { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";

import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { Registry } from "./registry/Registry";
import { buildSvcconfigRouter } from "./routes/svcconfig.route";

type CreateAppOptions = {
  slug: string;
  version: number;
  envDto: SvcEnvDto;
  envReloader: () => Promise<SvcEnvDto>;
};

class SvcconfigApp extends AppBase {
  /** Concrete per-service DTO registry (explicit, no barrels). */
  private readonly registry: Registry;

  constructor(opts: CreateAppOptions) {
    // Initialize logger first so all subsequent boot logs have proper context.
    setLoggerEnv(opts.envDto);

    super({
      service: opts.slug,
      version: opts.version,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
    });

    this.registry = new Registry();
  }

  /** ADR-0049: Base-typed accessor so handlers/controllers stay decoupled. */
  public override getDtoRegistry(): IDtoRegistry {
    return this.registry;
  }

  /**
   * Boot sequence (awaited by AppBase.boot()):
   * 1) Best-effort registry snapshot (non-fatal).
   * 2) Ensure indexes via Registry. On failure: log rich context, then rethrow (fail-fast).
   */
  protected override async onBoot(): Promise<void> {
    // 1) Best-effort diagnostics
    try {
      const listed = this.registry.listRegistered(); // [{ type, collection }]
      this.log.info(
        { registry: listed },
        "boot: registry listRegistered() — types & collections"
      );
    } catch (err) {
      this.log.warn(
        { err: (err as Error)?.message },
        "boot: registry.listRegistered() failed — continuing to index ensure"
      );
    }

    // 2) Deterministic index creation using DTO-declared indexHints.
    this.log.info("boot: ensuring indexes via registry.ensureIndexes()");
    try {
      await this.registry.ensureIndexes(this.svcEnv, this.log);
      this.log.info("boot: ensureIndexes complete");
    } catch (err) {
      // Add operator guidance, keep the original stack, then bubble.
      this.log.warn(
        {
          err: (err as Error)?.message,
          hint: "Index ensure failed. Ops: verify NV_MONGO_URI/NV_MONGO_DB in svcenv, DTO.indexHints[], and connectivity. Service will not start without indexes.",
        },
        "boot: ensureIndexes threw — aborting boot (fail-fast)"
      );
      throw err; // bubble per SOP
    }
  }

  /** Mount service routes as one-liners under the versioned base. */
  protected override mountRoutes(): void {
    const base = this.healthBasePath(); // `/api/<slug>/v<version>`
    if (!base) {
      this.log.error({ reason: "no_base" }, "Failed to derive base path");
      throw new Error("Base path missing — check AppBase.healthBasePath()");
    }

    const r: Router = buildSvcconfigRouter(this);
    this.app.use(base, r);
    this.log.info({ base }, "routes mounted");
  }
}

/** Public factory: constructs, boots, and returns the Express instance holder. */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new SvcconfigApp(opts);
  await app.boot(); // ensures onBoot (indexes) completes BEFORE routes mount/serve
  return { app: app.instance };
}
