// backend/shared/src/health/checks/CallbackCheck.ts
/**
 * Purpose:
 * - Generic health check that runs a provided async callback.
 * - Use this to wrap DB pings, cache pings, external HTTP, etc.
 */

import type { IHealthCheck, HealthCheckResult } from "../types";

export class CallbackCheck implements IHealthCheck {
  public readonly name: string;
  public readonly critical: boolean;
  private readonly fn: () => Promise<unknown>;

  constructor(name: string, critical: boolean, fn: () => Promise<unknown>) {
    this.name = name;
    this.critical = critical;
    this.fn = fn;
  }

  async check(): Promise<HealthCheckResult> {
    await this.fn();
    return {
      name: this.name,
      ok: true,
      durationMs: 0,
      critical: this.critical,
    };
  }
}
