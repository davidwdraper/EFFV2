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
import { resolve } from "path";
import { existsSync } from "fs";
import { log as sharedLog, type BoundCtx } from "../util/Logger";
import { EnvLoader } from "../env/EnvLoader";

export interface BootstrapOptions {
  service: string;
  portEnvName?: string;
  host?: string;
  loadEnvFiles?: boolean;
  preStart?: () => Promise<void>;
  onReady?: () => void;
  onShutdown?: () => Promise<void>;
  logContext?: Record<string, unknown>;
}

type LoggerCore = {
  debug: (msg?: string, fields?: Record<string, unknown>) => void;
  info: (msg?: string, fields?: Record<string, unknown>) => void;
  warn: (msg?: string, fields?: Record<string, unknown>) => void;
  error: (msg?: string, fields?: Record<string, unknown>) => void;
  bind: (ctx: BoundCtx) => {
    debug: (msg?: string, fields?: Record<string, unknown>) => void;
    info: (msg?: string, fields?: Record<string, unknown>) => void;
    warn: (msg?: string, fields?: Record<string, unknown>) => void;
    error: (msg?: string, fields?: Record<string, unknown>) => void;
    edge: (msg?: string, fields?: Record<string, unknown>) => void;
  };
};

export class Bootstrap {
  private readonly opts: Required<
    Omit<BootstrapOptions, "preStart" | "onReady" | "onShutdown" | "logContext">
  > &
    Pick<
      BootstrapOptions,
      "preStart" | "onReady" | "onShutdown" | "logContext"
    >;

  private baseCtx: Record<string, unknown>;
  public readonly logger: LoggerCore;

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

    const fmt = (msg?: string, extra?: Record<string, unknown>) => {
      const merged = { ...this.baseCtx, ...(extra ?? {}) };
      const keys = Object.keys(merged);
      if (!msg && keys.length === 0) return undefined;
      if (keys.length === 0) return msg;
      const tail = keys.map((k) => `${k}=${stringifyVal(merged[k])}`).join(" ");
      return (msg ? `${msg} - ` : "") + tail;
    };

    this.logger = {
      debug: (msg, fields) => sharedLog.debug(fmt(msg, fields)),
      info: (msg, fields) => sharedLog.info(fmt(msg, fields)),
      warn: (msg, fields) => sharedLog.warn(fmt(msg, fields)),
      error: (msg, fields) => sharedLog.error(fmt(msg, fields)),
      bind: (ctx: BoundCtx) => sharedLog.bind(ctx),
    };
  }

  public setLogContext(fields: Record<string, unknown>): void {
    this.baseCtx = { ...this.baseCtx, ...fields };
  }

  public async run(buildHandler: () => RequestListener): Promise<void> {
    // === Env loading (delegated) ============================================
    if (this.opts.loadEnvFiles) {
      EnvLoader.loadAll({ cwd: process.cwd() });
      // Optional trace to confirm critical env presence; keep it quiet in prod.
      this.logger.debug("env_loaded", {
        ENV_FILE: process.env.ENV_FILE ?? "<unset>",
        MODE: process.env.MODE ?? process.env.NODE_ENV ?? "dev",
      });
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
      this.emit(30, "listening", {
        port,
        host: this.opts.host,
        pid: process.pid,
      });
      this.opts.onReady?.();
    });

    server.on("error", (err) => {
      this.emit(50, "server_error", { err: String(err) });
      process.exitCode = 1;
    });

    // === Graceful shutdown ===================================================
    const shutdown = async (signal: NodeJS.Signals) => {
      this.emit(20, "shutdown_signal", { signal });
      try {
        await this.opts.onShutdown?.();
      } catch (err) {
        this.emit(40, "shutdown_hook_error", { err: String(err) });
      } finally {
        server.close(() => {
          this.emit(20, "closed");
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
      this.emit(50, `${name}_failed`, { err: String(err) });
      throw err;
    }
  }

  private emit(
    level: 20 | 30 | 40 | 50,
    msg: string,
    extra?: Record<string, unknown>
  ): void {
    switch (level) {
      case 20:
        this.logger.debug(msg, extra);
        break;
      case 30:
        this.logger.info(msg, extra);
        break;
      case 40:
        this.logger.warn(msg, extra);
        break;
      case 50:
        this.logger.error(msg, extra);
        break;
    }
  }
}

function stringifyVal(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
