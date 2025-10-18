// backend/services/shared/src/bootstrap/ServiceEntrypoint.ts
/**
 * NowVibin (NV)
 * File: backend/services/shared/src/bootstrap/ServiceEntrypoint.ts
 *
 * Contract (compat):
 * - Preferred: buildApp() => BootableApp { boot(): Promise<void>; instance: Express }
 * - Legacy:    buildApp() => Express (RequestListener)
 *
 * Invariant:
 * - Never touch `.instance` until AFTER `boot()` resolves.
 */

import type { Express } from "express";
import type { RequestListener } from "http";
import { Bootstrap, type BootstrapOptions } from "./Bootstrap";

export type ServiceEntrypointOptions = Omit<
  BootstrapOptions,
  "service" | "preStart" | "onReady" | "onShutdown"
> & {
  service: string;
  logVersion?: number;
  preStart?: () => Promise<void> | void;
  onReady?: () => Promise<void> | void;
  onShutdown?: () => Promise<void> | void;
};

type BootableApp = {
  boot: () => Promise<void>;
  readonly instance: Express;
};

function isRequestListener(x: unknown): x is RequestListener {
  return typeof x === "function";
}

// IMPORTANT: Do NOT read `.instance` here — it may throw if not booted.
function isBootableApp(x: unknown): x is BootableApp {
  return !!x && typeof (x as any).boot === "function";
}

export class ServiceEntrypoint {
  private readonly service: string;
  private readonly opts: ServiceEntrypointOptions;

  constructor(opts: ServiceEntrypointOptions) {
    this.service = opts.service;
    this.opts = opts;
  }

  public async run(buildApp: () => BootableApp | Express): Promise<void> {
    const boot = new Bootstrap({
      service: this.service,
      portEnvName: this.opts.portEnvName,
      host: this.opts.host,
      loadEnvFiles: this.opts.loadEnvFiles,
      logContext: this.opts.logContext,
      preStart: async () => {
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

    const built = buildApp();

    // Preferred path: BootableApp → await boot() → then use .instance
    if (isBootableApp(built)) {
      await (built as BootableApp).boot();
      return await boot.run(() => (built as BootableApp).instance);
    }

    // Legacy path: plain Express RequestListener
    if (isRequestListener(built)) {
      return await boot.run(() => built);
    }

    // If someone returned an Express app object (rare), accept it as a handler
    if (typeof built === "function") {
      return await boot.run(() => built as unknown as RequestListener);
    }

    throw new TypeError(
      `[${this.service}] buildApp() must return a BootableApp (with .boot() and .instance) or an Express RequestListener`
    );
  }
}
