// backend/shared/src/health/checks/ProcessCheck.ts
/**
 * Purpose:
 * - Simple process-level check (event loop ok / memory snapshot).
 * - Non-critical by default.
 */

import type { IHealthCheck, HealthCheckResult } from "../types";

export class ProcessCheck implements IHealthCheck {
  public readonly name = "process";
  public readonly critical: boolean;

  constructor(opts?: { critical?: boolean }) {
    this.critical = !!opts?.critical;
  }

  async check(): Promise<HealthCheckResult> {
    const mem = process.memoryUsage();
    return {
      name: this.name,
      ok: true,
      durationMs: 0,
      critical: this.critical,
      details: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
    };
  }
}
