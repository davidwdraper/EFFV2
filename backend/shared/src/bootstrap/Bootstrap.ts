// backend/shared/src/bootstrap/Bootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Uniform, minimal service bootstrap: load envs (optional), run preStart(),
 *   start HTTP server, structured logs, and graceful shutdown.
 *
 * Usage (in a service's index.ts):
 *   const bootstrap = new Bootstrap({ service: "gateway", preStart: async () => {
 *     await getSvcConfig().load();
 *   }});
 *   await bootstrap.run(() => new GatewayApp().instance);
 */

import http from "http";
import { resolve } from "path";
import { config as loadEnv } from "dotenv";
import type { RequestListener } from "http";
import { requireEnv, requireNumber } from "../env";

export interface BootstrapOptions {
  service: string; // e.g., "gateway", "svcfacilitator"
  portEnvName?: string; // default: "PORT"
  host?: string; // default: "0.0.0.0"
  loadEnvFiles?: boolean; // default: true (.env, then .env.dev override)
  preStart?: () => Promise<void>; // run before listening (e.g., warm caches)
  onReady?: () => void; // called after listen
  onShutdown?: () => Promise<void>; // graceful shutdown hook
}

export class Bootstrap {
  private readonly opts: Required<
    Omit<BootstrapOptions, "preStart" | "onReady" | "onShutdown">
  > &
    Pick<BootstrapOptions, "preStart" | "onReady" | "onShutdown">;

  constructor(options: BootstrapOptions) {
    this.opts = {
      service: options.service,
      portEnvName: options.portEnvName ?? "PORT",
      host: options.host ?? "0.0.0.0",
      loadEnvFiles: options.loadEnvFiles ?? true,
      preStart: options.preStart,
      onReady: options.onReady,
      onShutdown: options.onShutdown,
    };
  }

  /** Start the HTTP server with an Express app or any Node request handler. */
  public async run(buildHandler: () => RequestListener): Promise<void> {
    if (this.opts.loadEnvFiles) {
      loadEnv({ path: resolve(process.cwd(), ".env") });
      loadEnv({ path: resolve(process.cwd(), ".env.dev"), override: true });
    }

    // Validate port from env
    const portStr = requireEnv(this.opts.portEnvName);
    const port = requireNumber(this.opts.portEnvName, portStr);

    // Pre-start hook
    if (this.opts.preStart) {
      await this.safe("preStart", this.opts.preStart);
    }

    // Build app and server
    const handler = buildHandler();
    const server = http.createServer(handler);

    // Start listening
    server.listen(port, this.opts.host, () => {
      this.log(30, "listening", { port, host: this.opts.host });
      if (this.opts.onReady) this.opts.onReady();
    });

    server.on("error", (err) => {
      this.log(50, "server_error", { err: String(err) });
      process.exitCode = 1;
    });

    // Graceful shutdown
    const shutdown = async (signal: NodeJS.Signals) => {
      this.log(20, "shutdown_signal", { signal });
      try {
        await this.opts.onShutdown?.();
      } catch (err) {
        this.log(40, "shutdown_hook_error", { err: String(err) });
      } finally {
        server.close(() => {
          this.log(20, "closed");
          process.exit(0);
        });
        // hard exit if close hangs
        setTimeout(() => process.exit(0), 3000).unref();
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  private async safe(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log(50, `${name}_failed`, { err: String(err) });
      throw err;
    }
  }

  private log(
    level: 20 | 30 | 40 | 50,
    msg: string,
    extra?: Record<string, unknown>
  ): void {
    console.log(
      JSON.stringify({
        level,
        service: this.opts.service,
        msg,
        ...(extra ?? {}),
      })
    );
  }
}
