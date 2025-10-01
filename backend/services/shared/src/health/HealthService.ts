// backend/shared/src/health/HealthService.ts
/**
 * Purpose:
 * - Aggregate and execute health checks; compute overall status.
 */

import type {
  IHealthCheck,
  HealthCheckResult,
  HealthReport,
  HealthStatus,
} from "./types";

export class HealthService {
  private readonly serviceName: string;
  private readonly startedAt: number;
  private readonly checks: IHealthCheck[] = [];

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.startedAt = Date.now();
  }

  public add(check: IHealthCheck): this {
    this.checks.push(check);
    return this;
  }

  public async run(): Promise<HealthReport> {
    const results: HealthCheckResult[] = [];
    for (const c of this.checks) {
      const t0 = Date.now();
      try {
        const r = await c.check();
        results.push({
          name: c.name,
          critical: c.critical,
          durationMs: Date.now() - t0,
          ok: r.ok,
          details: r.details,
          error: r.error,
        });
      } catch (err) {
        results.push({
          name: c.name,
          critical: c.critical,
          durationMs: Date.now() - t0,
          ok: false,
          error: String(err instanceof Error ? err.message : err),
        });
      }
    }

    const status = this.computeStatus(results);
    return {
      status,
      service: this.serviceName,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      checks: results,
    };
  }

  private computeStatus(results: HealthCheckResult[]): HealthStatus {
    const anyCriticalFail = results.some((r) => r.critical && !r.ok);
    if (anyCriticalFail) return "down";
    const anyNonCriticalFail = results.some((r) => !r.critical && !r.ok);
    return anyNonCriticalFail ? "degraded" : "ok";
  }
}
