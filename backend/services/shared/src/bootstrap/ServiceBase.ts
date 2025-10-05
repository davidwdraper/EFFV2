// backend/services/shared/src/bootstrap/ServiceBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0009 (ServiceBase — class-based service entrypoint)
 *
 * Purpose:
 * - Abstract base class for service entrypoints so every service boots identically.
 * - Handles: envs, preStart, Express app init, logging, shutdown.
 * - Each service extends this base and overrides only what it needs.
 *
 * Usage example:
 * ---------------------------------------------------------------------------
 * // backend/services/svcfacilitator/src/index.ts
 * import { ServiceBase } from "@nv/shared/bootstrap/ServiceBase";
 * import { SvcFacilitatorApp } from "./app";
 * import { preStartHydrateMirror } from "./boot/boot.hydrate";
 *
 * class Main extends ServiceBase {
 *   protected override async preStart(): Promise<void> {
 *     await preStartHydrateMirror();
 *   }
 *   protected override buildApp() { return new SvcFacilitatorApp().instance; }
 * }
 *
 * new Main("svcfacilitator").run().catch(() => process.exit(1));
 * ---------------------------------------------------------------------------
 */

import type { Express } from "express";
import { Bootstrap, type BootstrapOptions } from "./Bootstrap";
import { setLogger, getLogger } from "../util/logger.provider";

export type ServiceBaseOptions = Omit<
  BootstrapOptions,
  "service" | "preStart" | "onReady" | "onShutdown"
> & {
  /**
   * Optional: version for log binding context.
   * Does not affect routes, only structured log metadata.
   */
  logVersion?: number;
};

/**
 * Abstract base for all NowVibin backend services.
 * Provides uniform lifecycle control, logging, and failure semantics.
 */
export abstract class ServiceBase {
  protected readonly service: string;
  protected readonly opts: ServiceBaseOptions;

  constructor(service: string, opts: ServiceBaseOptions = {}) {
    this.service = service;
    this.opts = opts;
  }

  /** Hook: DB connections, cache warmup, etc. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected async preStart(): Promise<void> {}

  /** Hook: must return the Express app instance for this service. */
  protected abstract buildApp(): Express;

  /** Hook: runs once server is listening. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onReady(): void {}

  /** Hook: graceful shutdown cleanup. */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected async onShutdown(): Promise<void> {}

  /**
   * Standardized run sequence:
   * - Construct Bootstrap
   * - Install global logger provider
   * - Execute hooks (preStart, onReady, onShutdown)
   * - Run the HTTP server
   */
  public async run(): Promise<void> {
    const boot = new Bootstrap({
      service: this.service,
      portEnvName: this.opts.portEnvName,
      host: this.opts.host,
      loadEnvFiles: this.opts.loadEnvFiles,
      logContext: this.opts.logContext,
      preStart: async () => {
        setLogger(boot.logger);
        const l = getLogger().bind({
          slug: this.service,
          version: this.opts.logVersion ?? 1,
          url: "/boot",
        });
        l.info("preStart: begin");
        await this.preStart();
        l.info("preStart: complete");
      },
      onReady: () => {
        const l = getLogger().bind({
          slug: this.service,
          version: this.opts.logVersion ?? 1,
          url: "/listen",
        });
        l.info("listening");
        this.onReady();
      },
      onShutdown: async () => {
        const l = getLogger().bind({
          slug: this.service,
          version: this.opts.logVersion ?? 1,
          url: "/shutdown",
        });
        l.info("shutdown: begin");
        await this.onShutdown();
        l.info("shutdown: complete");
      },
    });

    setLogger(boot.logger);
    await boot.run(() => this.buildApp());
  }
}
