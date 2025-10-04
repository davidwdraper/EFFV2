// backend/shared/src/util/logger.provider.ts
/**
 * Purpose:
 * - Process-wide logger provider so any module can use the same logger
 *   that a service’s Bootstrap instantiated (without passing it everywhere).
 *
 * Usage:
 *   // In each service's index.ts, after creating Bootstrap:
 *   const boot = new Bootstrap({ service: process.env.SVC_NAME! });
 *   setLogger(boot.logger);
 *
 *   // Anywhere else:
 *   import { getLogger } from "@nv/shared/util/logger.provider";
 *   const log = getLogger();
 *   const l = log.bind({ slug:"user", version:1, url:"/api/user/v1/users" });
 *   l.info();  // INFO … user v1 /api/user/v1/users
 */

import { log as baseLogger, type BoundCtx } from "./Logger";

export type LoggerCore = {
  debug: (msg?: string, fields?: Record<string, unknown>) => void;
  info: (msg?: string, fields?: Record<string, unknown>) => void;
  warn: (msg?: string, fields?: Record<string, unknown>) => void;
  error: (msg?: string, fields?: Record<string, unknown>) => void;
  bind: (ctx: BoundCtx) => {
    debug: (msg?: string, fields?: Record<string, unknown>) => void;
    info: (msg?: string, fields?: Record<string, unknown>) => void;
    warn: (msg?: string, fields?: Record<string, unknown>) => void;
    error: (msg?: string, fields?: Record<string, unknown>) => void;
    edge: (msg?: string, fields?: Record<string, unknown>) => void; // present on bound logger
  };
};

let _injected: LoggerCore | null = null;

/** Install the service-scoped logger created by Bootstrap. Call once per process. */
export function setLogger(logger: LoggerCore): void {
  _injected = logger;
}

/** Clear the injected logger (primarily for tests). */
export function resetLogger(): void {
  _injected = null;
}

/** Get the process-wide logger (falls back to base logger if none injected). */
export function getLogger(): LoggerCore {
  return _injected ?? (baseLogger as unknown as LoggerCore);
}
