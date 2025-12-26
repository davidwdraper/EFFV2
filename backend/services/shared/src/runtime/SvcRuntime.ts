// backend/services/shared/src/runtime/SvcRuntime.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Canonical service runtime container, transport-agnostic.
 * - Single source of truth for:
 *   - identity (service/env/version/dbState)
 *   - env-backed vars (via EnvServiceDto; no duplication)
 *   - logger handle
 *   - problem factory
 *   - capability slots (db/s2s/audit/etc.)
 *
 * Invariants:
 * - No process.env access (ever).
 * - No Express/HTTP constructs (ever).
 * - No default/fallback config values: missing vars throw with Ops guidance.
 * - DTO encapsulation honored: SvcRuntime does NOT extract/persist a vars map.
 */

import type { IBoundLogger } from "../logger/Logger";
import { ProblemFactory, type ProblemJson } from "../problem/problem";
import { EnvServiceDto } from "../dto/env-service.dto";

export type SvcRuntimeIdentity = {
  serviceSlug: string;
  serviceVersion: number;
  env: string;
  dbState: string;
};

export type SvcRuntimeCaps = {
  /**
   * Capability slots.
   * Keep these as `unknown` until each capability contract is locked.
   * (We’ll tighten types once the builders are wired for all services.)
   */
  db?: unknown;
  s2s?: unknown;
  audit?: unknown;
  metrics?: unknown;
  cache?: unknown;
};

export class SvcRuntime {
  public readonly problem: ProblemFactory;

  public constructor(
    private readonly ident: SvcRuntimeIdentity,
    private readonly envDto: EnvServiceDto,
    private readonly log: IBoundLogger,
    private readonly caps: SvcRuntimeCaps = {}
  ) {
    // Validate identity (fail-fast)
    if (!ident?.serviceSlug?.trim()) {
      throw new Error(
        "RT_IDENT_INVALID: serviceSlug is required. Ops: construct SvcRuntime with a valid identity."
      );
    }
    if (
      typeof ident.serviceVersion !== "number" ||
      !Number.isFinite(ident.serviceVersion) ||
      ident.serviceVersion <= 0
    ) {
      throw new Error(
        "RT_IDENT_INVALID: serviceVersion must be a positive number. Ops: construct SvcRuntime with a valid identity."
      );
    }
    if (!ident?.env?.trim()) {
      throw new Error(
        "RT_IDENT_INVALID: env is required. Ops: construct SvcRuntime with a valid identity."
      );
    }
    if (!ident?.dbState?.trim()) {
      throw new Error(
        "RT_IDENT_INVALID: dbState is required. Ops: construct SvcRuntime with a valid identity."
      );
    }

    if (!envDto || typeof (envDto as any).getEnvVar !== "function") {
      throw new Error(
        "RT_ENV_DTO_INVALID: EnvServiceDto is required. Ops: pass the hydrated EnvServiceDto into SvcRuntime."
      );
    }

    if (!log || typeof (log as any).info !== "function") {
      throw new Error(
        "RT_LOGGER_INVALID: IBoundLogger is required. Ops: construct logger before runtime and inject it."
      );
    }

    this.problem = new ProblemFactory({
      serviceSlug: ident.serviceSlug,
      serviceVersion: ident.serviceVersion,
      env: ident.env,
    });

    // Boot trace (safe). We may read raw vars for diagnostics only; we do NOT store them.
    let varCount: number | undefined = undefined;
    try {
      const raw = this.envDto.getVarsRaw();
      varCount = raw && typeof raw === "object" ? Object.keys(raw).length : 0;
    } catch {
      varCount = undefined;
    }

    this.log.debug(
      {
        event: "rt_construct",
        service: ident.serviceSlug,
        version: ident.serviceVersion,
        env: ident.env,
        dbState: ident.dbState,
        varCount,
        caps: Object.keys(caps ?? {}),
      },
      "SvcRuntime constructed"
    );
  }

  // ───────────────────────────────────────────
  // Identity
  // ───────────────────────────────────────────

  public getServiceSlug(): string {
    return this.ident.serviceSlug;
  }

  public getServiceVersion(): number {
    return this.ident.serviceVersion;
  }

  public getEnv(): string {
    return this.ident.env;
  }

  public getDbState(): string {
    return this.ident.dbState;
  }

  public describe(): Record<string, unknown> {
    let varCount: number | undefined = undefined;
    try {
      const raw = this.envDto.getVarsRaw();
      varCount = raw && typeof raw === "object" ? Object.keys(raw).length : 0;
    } catch {
      varCount = undefined;
    }

    return {
      serviceSlug: this.ident.serviceSlug,
      serviceVersion: this.ident.serviceVersion,
      env: this.ident.env,
      dbState: this.ident.dbState,
      varCount,
      caps: Object.keys(this.caps ?? {}),
    };
  }

  // ───────────────────────────────────────────
  // Env vars (strict, DTO-backed)
  // ───────────────────────────────────────────

  public tryVar(key: string): string | undefined {
    const k = (key ?? "").trim();
    if (!k) return undefined;

    let raw: string;
    try {
      raw = this.envDto.getEnvVar(k);
    } catch {
      return undefined;
    }

    const s = typeof raw === "string" ? raw.trim() : "";
    return s ? s : undefined;
  }

  public getVar(key: string): string {
    const k = (key ?? "").trim();
    if (!k) {
      throw new Error(
        "RT_GETVAR_KEY_EMPTY: getVar(key) requires a non-empty key. Ops: fix caller."
      );
    }

    // Delegate to DTO, but normalize “present but empty” into a strict missing error.
    let raw: string;
    try {
      raw = this.envDto.getEnvVar(k);
    } catch {
      const p: ProblemJson = this.problem.envMissing(k);
      throw new Error(
        `RT_ENV_VAR_MISSING: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
      );
    }

    const s = typeof raw === "string" ? raw.trim() : "";
    if (s) return s;

    const p: ProblemJson = this.problem.envMissing(k);
    throw new Error(
      `RT_ENV_VAR_MISSING: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
    );
  }

  public getIntVar(key: string): number {
    const raw = this.getVar(key);
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      const p = this.problem.envInvalid(key, `expected integer, got "${raw}"`);
      throw new Error(
        `RT_ENV_VAR_INVALID: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
      );
    }
    return n;
  }

  public getPositiveIntVar(key: string): number {
    const n = this.getIntVar(key);
    if (n <= 0) {
      const raw = this.getVar(key);
      const p = this.problem.envInvalid(
        key,
        `expected positive integer, got "${raw}"`
      );
      throw new Error(
        `RT_ENV_VAR_INVALID: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
      );
    }
    return n;
  }

  // ───────────────────────────────────────────
  // Logger
  // ───────────────────────────────────────────

  public getLogger(): IBoundLogger {
    return this.log;
  }

  // ───────────────────────────────────────────
  // DTO access (explicit)
  // ───────────────────────────────────────────

  /**
   * Expose the EnvServiceDto itself for callers that legitimately need it
   * (e.g., logger env binding, reload plumbing).
   *
   * Invariant:
   * - Callers MUST NOT cache extracted vars; always ask the DTO/runtime.
   */
  public getEnvDto(): EnvServiceDto {
    return this.envDto;
  }

  // ───────────────────────────────────────────
  // Capabilities (typed later)
  // ───────────────────────────────────────────

  public getCaps(): SvcRuntimeCaps {
    return this.caps;
  }

  public tryCap<K extends keyof SvcRuntimeCaps>(
    k: K
  ): SvcRuntimeCaps[K] | undefined {
    return this.caps?.[k];
  }

  public getCap<K extends keyof SvcRuntimeCaps>(k: K): SvcRuntimeCaps[K] {
    const v = this.tryCap(k);
    if (v === undefined) {
      throw new Error(
        `RT_CAPABILITY_MISSING: capability "${String(
          k
        )}" is not available for service="${this.ident.serviceSlug}" v${
          this.ident.serviceVersion
        } env="${this.ident.env}". ` +
          "Ops/Dev: ensure runtime builder wires this capability before use."
      );
    }
    return v;
  }
}
