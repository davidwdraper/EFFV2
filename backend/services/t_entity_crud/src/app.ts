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

import type { Express } from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";

type CreateAppOptions = {
  slug: string;
  version: number;
  envDto: SvcEnvDto;
  /**
   * Supplies a fresh SvcEnvDto when /env/reload is called.
   * Must throw on failure (AppBase translates to 500).
   */
  envReloader: () => Promise<SvcEnvDto>;
};

/** Minimal template app class; add routes as one-liners in mountRoutes(). */
class TemplateCrudApp extends AppBase {
  constructor(opts: CreateAppOptions) {
    super({
      service: opts.slug,
      version: opts.version,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
    });
  }

  // Service-specific routes — keep to one-liners that import real routers.
  protected override mountRoutes(): void {
    // Example (commented until the template consumer adds real routers):
    // const base = `/api/${this.service}/v${this.version}`;
    // this.app.use(base, new UsersRouter(/* deps */).router());
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
  const app = new TemplateCrudApp(opts);
  await app.boot();
  return { app: app.instance };
}
