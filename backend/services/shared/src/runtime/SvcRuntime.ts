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
 *
 * Commit:
 * - Runtime var reads use EnvServiceDto.getVarsRaw() so DB keys are readable
 *   at runtime (HandlerBase.getVar remains guarded in envHelpers.ts).
 * - Allows envDto rotation on /env/reload so SvcRuntime and AppBase never drift.
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
  db?: unknown;
  s2s?: unknown;
  audit?: unknown;
  metrics?: unknown;
  cache?: unknown;
};

export class SvcRuntime {
  public readonly problem: ProblemFactory;

  // NOTE: envDto is mutable by design (env reload). It remains DTO-backed truth.
  private envDto: EnvServiceDto;

  public constructor(
    private readonly ident: SvcRuntimeIdentity,
    envDto: EnvServiceDto,
    private readonly log: IBoundLogger,
    private readonly caps: SvcRuntimeCaps = {}
  ) {
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

    if (!envDto || typeof (envDto as any).getVarsRaw !== "function") {
      throw new Error(
        "RT_ENV_DTO_INVALID: EnvServiceDto is required. Ops: pass the hydrated EnvServiceDto into SvcRuntime."
      );
    }

    if (!log || typeof (log as any).info !== "function") {
      throw new Error(
        "RT_LOGGER_INVALID: IBoundLogger is required. Ops: construct logger before runtime and inject it."
      );
    }

    this.envDto = envDto;

    this.problem = new ProblemFactory({
      serviceSlug: ident.serviceSlug,
      serviceVersion: ident.serviceVersion,
      env: ident.env,
    });

    this.log.debug(
      {
        event: "rt_construct",
        service: ident.serviceSlug,
        version: ident.serviceVersion,
        env: ident.env,
        dbState: ident.dbState,
        varCount: this.safeVarCount(this.envDto),
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
    return {
      serviceSlug: this.ident.serviceSlug,
      serviceVersion: this.ident.serviceVersion,
      env: this.ident.env,
      dbState: this.ident.dbState,
      varCount: this.safeVarCount(this.envDto),
      caps: Object.keys(this.caps ?? {}),
    };
  }

  // ───────────────────────────────────────────
  // Vars (strict, runtime-owned)
  // ───────────────────────────────────────────

  public tryVar(key: string): string | undefined {
    const k = (key ?? "").trim();
    if (!k) return undefined;

    const raw = this.tryVarRaw(k);
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

    const raw = this.tryVarRaw(k);
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

  /**
   * Env reload hook.
   *
   * Invariants:
   * - fresh env/slug/version MUST match runtime identity.
   * - We do not extract/store a second vars map; we rotate the DTO reference only.
   */
  public setEnvDto(fresh: EnvServiceDto): void {
    if (!fresh || typeof (fresh as any).getVarsRaw !== "function") {
      throw new Error(
        "RT_ENV_DTO_INVALID: setEnvDto(fresh) requires a valid EnvServiceDto."
      );
    }

    const freshEnv = (fresh.getEnvLabel?.() ?? fresh.env ?? "")
      .toString()
      .trim();
    const freshSlug = (fresh.slug ?? "").toString().trim();
    const freshVersion = Number.isFinite(fresh.version)
      ? Math.trunc(fresh.version)
      : Number.NaN;

    if (freshEnv && freshEnv !== this.ident.env) {
      throw new Error(
        `RT_ENV_RELOAD_MISMATCH: fresh env="${freshEnv}" does not match runtime env="${this.ident.env}". ` +
          "Ops/Dev: do not reload a different env into a running process; fix caller/service wiring."
      );
    }

    if (freshSlug && freshSlug !== this.ident.serviceSlug) {
      throw new Error(
        `RT_ENV_RELOAD_MISMATCH: fresh slug="${freshSlug}" does not match runtime serviceSlug="${this.ident.serviceSlug}". ` +
          "Ops/Dev: do not reload config for a different service."
      );
    }

    if (
      Number.isFinite(freshVersion) &&
      freshVersion !== this.ident.serviceVersion
    ) {
      throw new Error(
        `RT_ENV_RELOAD_MISMATCH: fresh version=${freshVersion} does not match runtime serviceVersion=${this.ident.serviceVersion}. ` +
          "Ops/Dev: do not reload config for a different major version."
      );
    }

    const beforeCount = this.safeVarCount(this.envDto);
    const afterCount = this.safeVarCount(fresh);

    this.envDto = fresh;

    this.log.info(
      {
        event: "rt_env_reloaded",
        service: this.ident.serviceSlug,
        version: this.ident.serviceVersion,
        env: this.ident.env,
        beforeVarCount: beforeCount,
        afterVarCount: afterCount,
      },
      "SvcRuntime envDto reloaded"
    );
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

  public getEnvDto(): EnvServiceDto {
    return this.envDto;
  }

  // ───────────────────────────────────────────
  // Capabilities
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

  // ───────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────

  private tryVarRaw(key: string): string | undefined {
    try {
      const raw = this.envDto.getVarsRaw();
      const v = (raw as any)?.[key];
      if (v === undefined || v === null) return undefined;
      return String(v);
    } catch {
      return undefined;
    }
  }

  private safeVarCount(dto: EnvServiceDto): number | undefined {
    try {
      const raw = dto.getVarsRaw();
      return raw && typeof raw === "object" ? Object.keys(raw).length : 0;
    } catch {
      return undefined;
    }
  }
}
