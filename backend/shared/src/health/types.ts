// backend/shared/src/health/types.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Contracts for health checks and aggregate results.
 */

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthCheckResult {
  name: string;
  ok: boolean;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
  critical?: boolean;
}

export interface IHealthCheck {
  readonly name: string;
  readonly critical: boolean;
  check(): Promise<HealthCheckResult>;
}

export interface HealthReport {
  status: HealthStatus;
  service: string;
  uptimeSec: number;
  checks: HealthCheckResult[];
}
