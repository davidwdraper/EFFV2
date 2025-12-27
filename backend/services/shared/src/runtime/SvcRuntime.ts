// backend/services/shared/src/runtime/SvcRuntime.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0074 (DB_STATE guardrail, getDbVar(), and `_infra` DBs)
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
 * DB vars (ADR-0074):
 * - DB-related keys (NV_MONGO_*) MUST be read via getDbVar()/tryDbVar().
 * - getVar()/tryVar() MUST reject DB vars to enforce the guardrail.
 * - DB_STATE decoration:
 *   • NV_MONGO_DB returns "<base>_<dbState>" for domain DBs
 *   • "*_infra" DBs ignore DB_STATE and return "<base>"
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

export type SvcRuntimeCapName = "db" | "s2s" | "audit" | "metrics" | "cache";

export type SvcRuntimeCapFactory<TCap = unknown> = (rt: SvcRuntime) => TCap;

export type SvcRuntimeCaps = Partial<
  Record<SvcRuntimeCapName, unknown | SvcRuntimeCapFactory>
> &
  Record<string, unknown | SvcRuntimeCapFactory | undefined>;

const DB_KEYS = new Set<string>([
  "NV_MONGO_URI",
  "NV_MONGO_DB",
  "NV_MONGO_COLLECTION",
  "NV_MONGO_COLLECTIONS",
  "NV_MONGO_USER",
  "NV_MONGO_PASS",
  "NV_MONGO_OPTIONS",
]);

export class SvcRuntime {
  public readonly problem: ProblemFactory;

  private envDto: EnvServiceDto;
  private readonly capCache: Map<string, unknown>;

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
    this.capCache = new Map<string, unknown>();

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
      capCache: Array.from(this.capCache.keys()),
    };
  }

  // ───────────────────────────────────────────
  // Vars (strict, runtime-owned)
  // ───────────────────────────────────────────

  public tryVar(key: string): string | undefined {
    const k = (key ?? "").trim();
    if (!k) return undefined;

    if (DB_KEYS.has(k)) {
      throw this.makeDbVarGuardrailError(k, "tryVar");
    }

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

    if (DB_KEYS.has(k)) {
      throw this.makeDbVarGuardrailError(k, "getVar");
    }

    const raw = this.tryVarRaw(k);
    const s = typeof raw === "string" ? raw.trim() : "";
    if (s) return s;

    const p: ProblemJson = this.problem.envMissing(k);
    throw new Error(
      `RT_ENV_VAR_MISSING: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
    );
  }

  /**
   * DB var access (ADR-0074).
   *
   * Rules:
   * - Only DB keys allowed here.
   * - NV_MONGO_DB applies DB_STATE decoration (unless *_infra).
   */
  public tryDbVar(key: string): string | undefined {
    const k = (key ?? "").trim();
    if (!k) return undefined;

    if (!DB_KEYS.has(k)) {
      throw new Error(
        `RT_TRYDBVAR_NOT_DB_KEY: "${k}" is not a DB var key. Dev: use tryVar("${k}") for non-DB vars.`
      );
    }

    if (k === "NV_MONGO_DB") {
      const base = this.tryVarRaw(k);
      const baseTrim = typeof base === "string" ? base.trim() : "";
      if (!baseTrim) return undefined;
      return this.decorateDbNameWithDbState(baseTrim, this.ident.dbState);
    }

    const raw = this.tryVarRaw(k);
    const s = typeof raw === "string" ? raw.trim() : "";
    return s ? s : undefined;
  }

  public getDbVar(key: string): string {
    const k = (key ?? "").trim();
    if (!k) {
      throw new Error(
        "RT_GETDBVAR_KEY_EMPTY: getDbVar(key) requires a non-empty key. Ops: fix caller."
      );
    }

    const v = this.tryDbVar(k);
    if (v !== undefined) return v;

    const p: ProblemJson = this.problem.envMissing(k);
    throw new Error(
      `RT_ENV_DBVAR_MISSING: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
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

  public setEnvDto(fresh: EnvServiceDto): void {
    if (!fresh || typeof (fresh as any).getVarsRaw !== "function") {
      throw new Error(
        "RT_ENV_DTO_INVALID: setEnvDto(fresh) requires a valid EnvServiceDto."
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
  // Capabilities (lazy, cached, fail-fast)
  // ───────────────────────────────────────────

  public getCapsRaw(): SvcRuntimeCaps {
    return this.caps;
  }

  public setCap(name: string, instance: unknown): void {
    const k = (name ?? "").trim();
    if (!k) {
      throw new Error(
        "RT_SET_CAP_KEY_EMPTY: setCap(name, instance) requires a non-empty name. Ops: fix caller."
      );
    }
    (this.caps as any)[k] = instance;
    this.capCache.delete(k);
  }

  public setCapFactory(name: string, factory: SvcRuntimeCapFactory): void {
    const k = (name ?? "").trim();
    if (!k) {
      throw new Error(
        "RT_SET_CAP_KEY_EMPTY: setCapFactory(name, factory) requires a non-empty name. Ops: fix caller."
      );
    }
    if (typeof factory !== "function") {
      throw new Error(
        "RT_SET_CAP_FACTORY_INVALID: setCapFactory(name, factory) requires a function factory. Ops: fix caller."
      );
    }
    (this.caps as any)[k] = factory;
    this.capCache.delete(k);
  }

  public tryCap<TCap = unknown>(name: string): TCap | undefined {
    const k = (name ?? "").trim();
    if (!k) return undefined;

    if (this.capCache.has(k)) {
      return this.capCache.get(k) as TCap;
    }

    const slot = (this.caps as any)?.[k] as
      | unknown
      | SvcRuntimeCapFactory
      | undefined;

    if (slot === undefined) return undefined;

    if (typeof slot === "function") {
      let built: unknown;
      try {
        built = (slot as SvcRuntimeCapFactory)(this);
      } catch (err) {
        const detail =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        throw new Error(
          `RT_CAPABILITY_BUILD_FAILED: capability "${k}" factory threw for service="${this.ident.serviceSlug}" v${this.ident.serviceVersion} env="${this.ident.env}". ` +
            `Detail: ${detail} ` +
            "Ops/Dev: fix the runtime builder/factory wiring for this capability."
        );
      }

      if (built === undefined) {
        throw new Error(
          `RT_CAPABILITY_BUILD_INVALID: capability "${k}" factory returned undefined for service="${this.ident.serviceSlug}" v${this.ident.serviceVersion} env="${this.ident.env}". ` +
            "Ops/Dev: factories must return a concrete instance or throw."
        );
      }

      this.capCache.set(k, built);
      return built as TCap;
    }

    this.capCache.set(k, slot);
    return slot as TCap;
  }

  public getCap<TCap = unknown>(name: string): TCap {
    const v = this.tryCap<TCap>(name);
    if (v === undefined) {
      throw new Error(
        `RT_CAPABILITY_MISSING: capability "${String(
          (name ?? "").trim()
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

  private makeDbVarGuardrailError(key: string, method: string): Error {
    const msg =
      `ENV_DBVAR_USE_GETDBVAR: "${key}" is DB-related and must be accessed via getDbVar("${key}"). ` +
      `Context: env="${this.ident.env}", slug="${this.ident.serviceSlug}", version=${this.ident.serviceVersion}. ` +
      `Dev: replace rt.${method}("${key}") with rt.getDbVar("${key}").`;
    return new Error(msg);
  }

  private decorateDbNameWithDbState(base: string, dbState: string): string {
    const b = (base ?? "").trim();
    if (!b) return "";

    const st = (dbState ?? "").trim();
    if (!st) return "";

    if (b.toLowerCase().endsWith("_infra")) return b;

    return `${b}_${st}`;
  }
}
