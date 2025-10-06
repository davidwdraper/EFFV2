/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *
 * Purpose:
 * - Composition root for all NowVibin backend services.
 * - Owns the boot sequence and lifecycle (start, ready, shutdown).
 * - Delegates actual service logic to an app builder function.
 *
 * Key difference from old ServiceBase:
 * - No inheritance. This is a self-contained runner.
 * - Calls setRootLogger() once; no logger.provider mutations.
 */

import type { Express } from "express";
import { Bootstrap, type BootstrapOptions } from "./Bootstrap";
import { setRootLogger } from "../logger/Logger";

export type ServiceEntrypointOptions = Omit<
  BootstrapOptions,
  "service" | "preStart" | "onReady" | "onShutdown"
> & {
  /** Service slug (e.g. gateway, auth, user) */
  service: string;

  /** Optional version number for structured log context */
  logVersion?: number;

  /** Optional hooks */
  preStart?: () => Promise<void> | void;
  onReady?: () => Promise<void> | void;
  onShutdown?: () => Promise<void> | void;
};

export class ServiceEntrypoint {
  private readonly service: string;
  private readonly opts: ServiceEntrypointOptions;

  constructor(opts: ServiceEntrypointOptions) {
    this.service = opts.service;
    this.opts = opts;
  }

  /**
   * Start the service using the provided app factory.
   * The app factory must return an initialized Express instance.
   */
  public async run(buildApp: () => Express): Promise<void> {
    const boot = new Bootstrap({
      service: this.service,
      portEnvName: this.opts.portEnvName,
      host: this.opts.host,
      loadEnvFiles: this.opts.loadEnvFiles,
      logContext: this.opts.logContext,
      preStart: async () => {
        setRootLogger(boot.logger);
        const log = boot.logger.bind({
          slug: this.service,
          version: this.opts.logVersion ?? 1,
          phase: "preStart",
        });
        log.info("bootstrap: preStart");
        if (this.opts.preStart) await this.opts.preStart();
      },
      onReady: async () => {
        const log = boot.logger.bind({
          slug: this.service,
          version: this.opts.logVersion ?? 1,
          phase: "ready",
        });
        log.info("bootstrap: ready");
        if (this.opts.onReady) await this.opts.onReady();
      },
      onShutdown: async () => {
        const log = boot.logger.bind({
          slug: this.service,
          version: this.opts.logVersion ?? 1,
          phase: "shutdown",
        });
        log.info("bootstrap: shutdown begin");
        if (this.opts.onShutdown) await this.opts.onShutdown();
        log.info("bootstrap: shutdown complete");
      },
    });

    setRootLogger(boot.logger);
    await boot.run(buildApp);
  }
}
