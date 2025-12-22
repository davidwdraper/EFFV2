// backend/services/shared/src/sandbox/SvcSandbox.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Canonical service runtime container, transport-agnostic.
 * - Single source of truth for:
 *   - identity (service/env/version/dbState)
 *   - validated vars (string map)
 *   - logger handle
 *   - problem factory
 *   - capability slots (db/s2s/audit/etc.)
 *
 * Invariants:
 * - No process.env access (ever).
 * - No Express/HTTP constructs (ever).
 * - No default/fallback config values: missing vars throw with Ops guidance.
 */

import type { IBoundLogger } from "../logger/Logger";
import { ProblemFactory, type ProblemJson } from "../problem/problem";

export type SvcSandboxIdentity = {
  serviceSlug: string;
  serviceVersion: number;
  env: string;
  dbState: string;
};

export type SvcSandboxCaps = {
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

export class SvcSandbox {
  public readonly problem: ProblemFactory;

  public constructor(
    private readonly ident: SvcSandboxIdentity,
    private readonly vars: Record<string, string>,
    private readonly log: IBoundLogger,
    private readonly caps: SvcSandboxCaps = {}
  ) {
    // Validate identity (fail-fast)
    if (!ident?.serviceSlug?.trim()) {
      throw new Error(
        "SSB_IDENT_INVALID: serviceSlug is required. Ops: construct SvcSandbox with a valid identity."
      );
    }
    if (
      typeof ident.serviceVersion !== "number" ||
      !Number.isFinite(ident.serviceVersion) ||
      ident.serviceVersion <= 0
    ) {
      throw new Error(
        "SSB_IDENT_INVALID: serviceVersion must be a positive number. Ops: construct SvcSandbox with a valid identity."
      );
    }
    if (!ident?.env?.trim()) {
      throw new Error(
        "SSB_IDENT_INVALID: env is required. Ops: construct SvcSandbox with a valid identity."
      );
    }
    if (!ident?.dbState?.trim()) {
      throw new Error(
        "SSB_IDENT_INVALID: dbState is required. Ops: construct SvcSandbox with a valid identity."
      );
    }

    if (!vars || typeof vars !== "object") {
      throw new Error(
        "SSB_VARS_INVALID: vars map is required. Ops: pass the merged/validated env-service vars into SvcSandbox."
      );
    }

    if (!log || typeof (log as any).info !== "function") {
      throw new Error(
        "SSB_LOGGER_INVALID: IBoundLogger is required. Ops: construct logger before sandbox and inject it."
      );
    }

    this.problem = new ProblemFactory({
      serviceSlug: ident.serviceSlug,
      serviceVersion: ident.serviceVersion,
      env: ident.env,
    });

    // Boot trace (safe)
    this.log.debug(
      {
        event: "ssb_construct",
        service: ident.serviceSlug,
        version: ident.serviceVersion,
        env: ident.env,
        dbState: ident.dbState,
        varCount: Object.keys(vars).length,
        caps: Object.keys(caps ?? {}),
      },
      "SvcSandbox constructed"
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
      varCount: Object.keys(this.vars).length,
      caps: Object.keys(this.caps ?? {}),
    };
  }

  // ───────────────────────────────────────────
  // Vars (strict)
  // ───────────────────────────────────────────

  public tryVar(key: string): string | undefined {
    const k = (key ?? "").trim();
    if (!k) return undefined;
    const v = this.vars[k];
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s : undefined;
  }

  public getVar(key: string): string {
    const k = (key ?? "").trim();
    if (!k) {
      throw new Error(
        "SSB_GETVAR_KEY_EMPTY: getVar(key) requires a non-empty key. Ops: fix caller."
      );
    }

    const v = this.tryVar(k);
    if (v !== undefined) return v;

    // Throw with Ops guidance + consistent problem shape
    const p: ProblemJson = this.problem.envMissing(k);
    throw new Error(
      `SSB_ENV_VAR_MISSING: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
    );
  }

  public getIntVar(key: string): number {
    const raw = this.getVar(key);
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      const p = this.problem.envInvalid(key, `expected integer, got "${raw}"`);
      throw new Error(
        `SSB_ENV_VAR_INVALID: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
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
        `SSB_ENV_VAR_INVALID: ${p.detail} ${p.ops ? `Ops: ${p.ops}` : ""}`
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
  // Capabilities (typed later)
  // ───────────────────────────────────────────

  public getCaps(): SvcSandboxCaps {
    return this.caps;
  }

  public tryCap<K extends keyof SvcSandboxCaps>(
    k: K
  ): SvcSandboxCaps[K] | undefined {
    return this.caps?.[k];
  }

  public getCap<K extends keyof SvcSandboxCaps>(k: K): SvcSandboxCaps[K] {
    const v = this.tryCap(k);
    if (v === undefined) {
      throw new Error(
        `SSB_CAPABILITY_MISSING: capability "${String(
          k
        )}" is not available for service="${this.ident.serviceSlug}" v${
          this.ident.serviceVersion
        } env="${this.ident.env}". ` +
          "Ops/Dev: ensure sandbox builder wires this capability before use."
      );
    }
    return v;
  }
}
