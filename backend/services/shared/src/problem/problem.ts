// backend/services/shared/src/problem/problem.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0043 (Finalize mapping / failure propagation)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Transport-agnostic Problem primitives (RFC7807-ish).
 * - Single source of truth for:
 *   - ProblemJson wire shape
 *   - ProblemFactory helpers used by sandbox/handlers/controllers
 *
 * Invariants:
 * - No Express/HTTP framework imports.
 * - No process.env access.
 * - No defaults/fallbacks: callers decide what is required; factory builds problems.
 */

export type ProblemJson = {
  type: string; // e.g. "about:blank" or a stable URN
  title: string;
  status: number;

  detail?: string;
  code?: string;

  requestId?: string;

  serviceSlug?: string;
  serviceVersion?: number;
  env?: string;

  ops?: string;
  meta?: Record<string, unknown>;
};

export class ProblemFactory {
  private readonly serviceSlug: string;
  private readonly serviceVersion: number;
  private readonly env: string;

  public constructor(opts: {
    serviceSlug: string;
    serviceVersion: number;
    env: string;
  }) {
    if (!opts?.serviceSlug?.trim()) {
      throw new Error(
        "PROBLEM_FACTORY_INVALID: serviceSlug is required. Ops: pass a valid serviceSlug."
      );
    }
    if (
      typeof opts.serviceVersion !== "number" ||
      !Number.isFinite(opts.serviceVersion) ||
      opts.serviceVersion <= 0
    ) {
      throw new Error(
        "PROBLEM_FACTORY_INVALID: serviceVersion must be a positive number. Ops: pass a valid serviceVersion."
      );
    }
    if (!opts?.env?.trim()) {
      throw new Error(
        "PROBLEM_FACTORY_INVALID: env is required. Ops: pass a valid env label."
      );
    }

    this.serviceSlug = opts.serviceSlug.trim();
    this.serviceVersion = opts.serviceVersion;
    this.env = opts.env.trim();
  }

  private base(
    p: Omit<ProblemJson, "serviceSlug" | "serviceVersion" | "env">
  ): ProblemJson {
    return {
      serviceSlug: this.serviceSlug,
      serviceVersion: this.serviceVersion,
      env: this.env,
      ...p,
    };
  }

  public internalError(detail?: string, ops?: string): ProblemJson {
    return this.base({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      code: "INTERNAL_ERROR",
      detail: detail ?? "An unexpected error occurred.",
      ops,
    });
  }

  public notImplemented(detail: string, ops?: string): ProblemJson {
    return this.base({
      type: "about:blank",
      title: "Not Implemented",
      status: 501,
      code: "NOT_IMPLEMENTED",
      detail,
      ops,
    });
  }

  // ───────────────────────────────────────────
  // Env / config helpers (used by SvcSandbox)
  // ───────────────────────────────────────────

  public envMissing(key: string): ProblemJson {
    const k = (key ?? "").trim();
    return this.base({
      type: "about:blank",
      title: "Missing Configuration",
      status: 500,
      code: "ENV_VAR_MISSING",
      detail: `ENV_VAR_MISSING: "${k}" is not defined for env="${this.env}", service="${this.serviceSlug}" v${this.serviceVersion}.`,
      ops: `Set "${k}" in env-service for env="${this.env}", slug="${this.serviceSlug}", version=${this.serviceVersion}.`,
    });
  }

  public envInvalid(key: string, reason: string): ProblemJson {
    const k = (key ?? "").trim();
    const r = (reason ?? "").trim();
    return this.base({
      type: "about:blank",
      title: "Invalid Configuration",
      status: 500,
      code: "ENV_VAR_INVALID",
      detail: `ENV_VAR_INVALID: "${k}" is invalid (${r}) for env="${this.env}", service="${this.serviceSlug}" v${this.serviceVersion}.`,
      ops: `Fix "${k}" in env-service for env="${this.env}", slug="${this.serviceSlug}", version=${this.serviceVersion}.`,
    });
  }
}
