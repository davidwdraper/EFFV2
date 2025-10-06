/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0018 (Debug Log Origin Capture)
 *
 * Purpose:
 * - Root for runtime classes (controllers, routers, repos, etc.).
 * - Provides consistent logger + env access across all services.
 *
 * Notes:
 * - Uses shared logger with .bind(ctx). No logger.provider anywhere.
 * - service defaults from SVC_NAME to keep logs coherent per service.
 */

import { getLogger, type IBoundLogger } from "../logger/Logger";

type Dict = Record<string, unknown>;

export abstract class ServiceBase {
  protected readonly service: string;
  protected readonly log: IBoundLogger;
  private readonly baseLogContext: Dict;

  constructor(opts?: { service?: string; context?: Dict }) {
    this.service =
      (opts?.service || process.env.SVC_NAME || "unknown").trim() || "unknown";
    this.baseLogContext = {
      service: this.service,
      component: this.constructor.name,
      ...(opts?.context || {}),
    };
    this.log = getLogger().bind(this.baseLogContext);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Env helpers (fail-fast; no silent fallbacks)
  // ────────────────────────────────────────────────────────────────────────────

  protected env(name: string): string | undefined {
    const v = process.env[name];
    return v === undefined ? undefined : String(v);
  }

  protected getEnv(name: string, required = true): string | undefined {
    const raw = this.env(name);
    const val = raw?.trim();
    if (!val) {
      if (required) throw new Error(`Missing required env: ${name}`);
      return undefined;
    }
    return val;
  }

  protected getEnvInt(name: string, required = true): number | undefined {
    const v = this.getEnv(name, required);
    if (v == null) return undefined;
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) {
      if (required) throw new Error(`Invalid integer env: ${name}="${v}"`);
      return undefined;
    }
    return n;
  }

  protected getEnvBool(name: string, required = true): boolean | undefined {
    const v = this.getEnv(name, required);
    if (v == null) return undefined;
    const s = v.toLowerCase();
    if (s === "1" || s === "true" || s === "yes") return true;
    if (s === "0" || s === "false" || s === "no") return false;
    if (required) throw new Error(`Invalid boolean env: ${name}="${v}"`);
    return undefined;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Logger helpers
  // ────────────────────────────────────────────────────────────────────────────

  protected bindLog(ctx: Dict): IBoundLogger {
    return this.log.bind(ctx);
  }

  protected getLogContext(): Dict {
    return { ...this.baseLogContext };
  }
}
