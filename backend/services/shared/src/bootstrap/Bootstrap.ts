// backend/services/shared/src/bootstrap/Bootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Uniform, minimal service bootstrap: load envs (optional), run preStart(),
 *   start HTTP server, structured logs, and graceful shutdown.
 *
 * Environment loading (Separation of Concerns):
 * - Delegated to EnvLoader (shared/env/EnvLoader.ts).
 * - Order: ENV_FILE (if set) → repo-root .env → repo-root .env.<mode> →
 *          service-local .env → service-local .env.<mode>
 * - Root keys are authoritative; service-local files do NOT override them.
 * - Fail-fast for required keys.
 */

import http, { type RequestListener } from "http";
import path from "path";
import { EnvLoader } from "../env/EnvLoader";
import { getLogger, type IBoundLogger } from "../logger/Logger";

export interface BootstrapOptions {
  service: string;
  portEnvName?: string;
  host?: string;
  loadEnvFiles?: boolean;
  preStart?: () => Promise<void>;
  onReady?: () => void;
  onShutdown?: () => Promise<void>;
  /** Extra fields to bind on the process logger (e.g., version, role). */
  logContext?: Record<string, unknown>;
}

export class Bootstrap {
  private readonly opts: Required<
    Omit<BootstrapOptions, "preStart" | "onReady" | "onShutdown" | "logContext">
  > &
    Pick<
      BootstrapOptions,
      "preStart" | "onReady" | "onShutdown" | "logContext"
    >;

  private baseCtx: Record<string, unknown>;
  private loggerHandle: IBoundLogger;

  /** Process logger bound with baseCtx. Use .bind() to add per-phase context. */
  public get logger(): IBoundLogger {
    return this.loggerHandle;
  }

  constructor(options: BootstrapOptions) {
    this.opts = {
      service: options.service,
      portEnvName: options.portEnvName ?? "PORT",
      host: options.host ?? "0.0.0.0",
      loadEnvFiles: options.loadEnvFiles ?? true,
      preStart: options.preStart,
      onReady: options.onReady,
      onShutdown: options.onShutdown,
      logContext: options.logContext,
    };

    this.baseCtx = {
      service: this.opts.service,
      ...(options.logContext ?? {}),
    };

    // Bind a process-level logger once; caller can .bind() more context per phase.
    this.loggerHandle = getLogger().bind(this.baseCtx);
  }

  /** Merge additional fields into the base logging context (rebinds logger). */
  public setLogContext(fields: Record<string, unknown>): void {
    this.baseCtx = { ...this.baseCtx, ...fields };
    this.loggerHandle = getLogger().bind(this.baseCtx);
  }

  public async run(buildHandler: () => RequestListener): Promise<void> {
    // === Env loading (delegated) ============================================
    if (this.opts.loadEnvFiles) {
      // Determine the *service* directory so service-local .env.* are considered.
      const repoRootCwd = process.cwd();
      const envFile = process.env.ENV_FILE || "";
      const envFileDir = envFile
        ? path.isAbsolute(envFile)
          ? path.dirname(envFile)
          : path.dirname(path.resolve(repoRootCwd, envFile))
        : null;
      const serviceDir =
        process.env.SERVICE_CWD || // explicit override from service entry
        envFileDir || // if ENV_FILE points to service/.env.dev, use its dir
        repoRootCwd; // fallback to repo root

      EnvLoader.loadAll({
        cwd: serviceDir,
        debugLogger: (m) => this.logger.debug({ serviceDir }, m),
      });

      this.logger.debug(
        {
          ENV_FILE: process.env.ENV_FILE ?? "<unset>",
          MODE: process.env.MODE ?? process.env.NODE_ENV ?? "dev",
          SERVICE_CWD: serviceDir,
        },
        "env_loaded"
      );
    }

    // === Required runtime configuration =====================================
    const port = EnvLoader.requireNumber(this.opts.portEnvName);

    // === Pre-start hook (DB connect, warm caches, etc.) ======================
    if (this.opts.preStart) {
      await this.safe("preStart", this.opts.preStart);
    }

    // === HTTP server bootstrap ==============================================
    const handler = buildHandler();
    const server = http.createServer(handler);

    server.listen(port, this.opts.host, () => {
      this.emit("info", "listening", {
        port,
        host: this.opts.host,
        pid: process.pid,
      });
      this.opts.onReady?.();
    });

    server.on("error", (err) => {
      this.emit("error", "server_error", { err: String(err) });
      process.exitCode = 1;
    });

    // === Graceful shutdown ===================================================
    const shutdown = async (signal: NodeJS.Signals) => {
      this.emit("debug", "shutdown_signal", { signal });
      try {
        await this.opts.onShutdown?.();
      } catch (err) {
        this.emit("warn", "shutdown_hook_error", { err: String(err) });
      } finally {
        server.close(() => {
          this.emit("debug", "closed");
          process.exit(0);
        });
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
      this.emit("error", `${name}_failed`, { err: String(err) });
      throw err;
    }
  }

  private emit(
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    extra?: Record<string, unknown>
  ): void {
    const log = this.logger;
    const call = (method: "debug" | "info" | "warn" | "error") => {
      if (extra && Object.keys(extra).length > 0) {
        // structured overload
        log[method](extra, msg);
      } else {
        // string-only overload
        log[method](msg);
      }
    };

    switch (level) {
      case "debug":
        call("debug");
        break;
      case "info":
        call("info");
        break;
      case "warn":
        call("warn");
        break;
      case "error":
        call("error");
        break;
    }
  }
}
