// backend/services/shared/src/base/app/processEnvGuard.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0076 (Process Env Guard — opt-in runtime guardrail)
 *
 * Purpose:
 * - Optional runtime guardrail that blocks *direct* `process.env` access after boot.
 * - Forces NV code paths to use EnvServiceDto-backed accessors instead of raw env.
 *
 * Invariants:
 * - Opt-in only: controlled by NV_PROCESS_ENV_GUARD (read from EnvServiceDto).
 * - Must lock once: no mutable allowlists after lock.
 * - Must throw with actionable Ops guidance when blocked.
 * - Must not break Node internals: Node may lazily read env (e.g., FORCE_COLOR) during console/util work.
 */

export type ProcessEnvGuardInstallOpts = {
  service: string;
  envLabel: string;
  /**
   * If true, installs the guard and locks immediately.
   * (We intentionally lock right away in AppBase.boot() after mount/wiring.)
   */
  lockImmediately: boolean;
};

type GuardState = {
  installed: boolean;
  locked: boolean;
  originalEnv: NodeJS.ProcessEnv | null;
};

const state: GuardState = {
  installed: false,
  locked: false,
  originalEnv: null,
};

function isTruthy(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function buildBlockedError(opts: {
  service: string;
  envLabel: string;
  key: string;
}): Error {
  const { service, envLabel, key } = opts;

  return new Error(
    `PROCESS_ENV_GUARD_BLOCKED: Direct process.env access is blocked after boot. ` +
      `Attempted key="${key}" in service="${service}" env="${envLabel}". ` +
      `Ops: remove raw process.env usage; use EnvServiceDto.getEnvVar()/tryEnvVar() via svcEnv instead. ` +
      `Ops: ensure the needed key exists in env-service for (env="${envLabel}", slug="${service}", version=<major>). ` +
      `Note: do NOT add fallbacks; fail-fast when required config is missing.`
  );
}

function isNodeInternalAccess(): boolean {
  const stack = new Error().stack;
  if (!stack) return false;

  // Node internals commonly show up as `node:internal/...`
  if (stack.includes("node:internal")) return true;

  // Some frames show as absolute paths containing `/internal/` depending on runtime/build.
  if (stack.includes("/internal/") || stack.includes("\\internal\\"))
    return true;

  return false;
}

function installProxy(opts: { service: string; envLabel: string }): void {
  if (state.installed) return;

  // Capture the original env object once.
  const original = process.env;
  state.originalEnv = original;

  const proxy = new Proxy(original, {
    get(_target, prop: string | symbol): unknown {
      if (!state.locked) {
        // Before lock: behave exactly like normal.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any)[prop as any];
      }

      if (typeof prop === "symbol") {
        // Avoid breaking common inspection paths.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any)[prop as any];
      }

      // Allow Node internals to read env lazily (e.g., FORCE_COLOR during console/util work).
      // We are guarding *our* code paths, not Node itself.
      if (isNodeInternalAccess()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any)[prop as any];
      }

      throw buildBlockedError({
        service: opts.service,
        envLabel: opts.envLabel,
        key: prop,
      });
    },

    set(_target, prop: string | symbol, value: unknown): boolean {
      if (!state.locked) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (original as any)[prop as any] = value as any;
        return true;
      }

      if (typeof prop === "symbol") return true;

      // Allow Node internals to mutate env if they ever do (rare), to avoid runtime breakage.
      if (isNodeInternalAccess()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (original as any)[prop as any] = value as any;
        return true;
      }

      throw buildBlockedError({
        service: opts.service,
        envLabel: opts.envLabel,
        key: String(prop),
      });
    },

    // Keep common enumeration behavior stable.
    ownKeys(): ArrayLike<string | symbol> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Reflect.ownKeys(original as any);
    },

    getOwnPropertyDescriptor(_target, prop: string | symbol) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Object.getOwnPropertyDescriptor(original as any, prop as any);
    },
  });

  // Replace process.env with our proxy.
  // If this ever fails, we should fail-fast loudly when NV_PROCESS_ENV_GUARD=true.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).env = proxy as any;
  } catch (err) {
    throw new Error(
      `PROCESS_ENV_GUARD_INSTALL_FAILED: Failed to install process.env guard for service="${opts.service}". ` +
        `Ops: ensure the Node runtime allows process.env replacement (writable process.env). ` +
        `Detail: ${(err as Error)?.message ?? String(err)}`
    );
  }

  state.installed = true;
}

function lock(): void {
  if (!state.installed) {
    throw new Error(
      "PROCESS_ENV_GUARD_LOCK_ILLEGAL: guard is not installed; cannot lock."
    );
  }
  state.locked = true;
}

/**
 * Reads NV_PROCESS_ENV_GUARD from EnvServiceDto-derived values (caller provides raw string).
 * Missing/invalid => treated as disabled (opt-in feature flag).
 */
export function isProcessEnvGuardEnabled(
  raw: string | null | undefined
): boolean {
  if (raw == null) return false;
  try {
    return isTruthy(raw);
  } catch {
    return false;
  }
}

/**
 * Installs the guard (idempotent) and optionally locks it immediately.
 */
export function installProcessEnvGuard(opts: ProcessEnvGuardInstallOpts): void {
  installProxy({ service: opts.service, envLabel: opts.envLabel });
  if (opts.lockImmediately) lock();
}

/**
 * For diagnostics (tests / debug logs).
 */
export function getProcessEnvGuardState(): {
  installed: boolean;
  locked: boolean;
} {
  return { installed: state.installed, locked: state.locked };
}
