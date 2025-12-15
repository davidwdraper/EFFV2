// backend/services/test-runner/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 *
 * Invariants:
 * - test-runner is MOS-only: checkDb MUST be false (no DB vars, no index ensure).
 * - test-log is the DB-backed service that persists results (test-run, test-handler).
 *
 * S2S mocks wiring:
 * - When S2S_MOCKS=true (from env-service vars), test-runner injects a deterministic
 *   ISvcClientTransport so handler tests can be green without real downstream services.
 * - When S2S_MOCKS=false, runtime uses the default fetch transport.
 */

import type { Express, Router } from "express";
import { AppBase } from "@nv/shared/base/app/AppBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";
import type {
  ISvcClientTransport,
  RawResponse,
} from "@nv/shared/s2s/SvcClient";

import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { Registry } from "./registry/Registry";
import { buildTestRunnerRouter } from "./routes/test-runner.route";

type CreateAppOptions = {
  slug: string;
  version: number;
  /**
   * Logical environment label for this process (e.g., "dev", "stage", "prod").
   * - Passed through from envBootstrap.envLabel.
   * - Any SvcClient created inside this service should use this value for `env`.
   */
  envLabel: string;
  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
};

function requireBoolVarFromDto(dto: EnvServiceDto, name: string): boolean {
  let raw: string;
  try {
    raw = dto.getEnvVar(name);
  } catch (err) {
    throw new Error(
      `${name}_MISSING: ${name} is required and must be "true" or "false". ` +
        `Ops: set ${name} explicitly in env-service for env="${dto.getEnvLabel()}". ` +
        `Detail: ${(err as Error)?.message ?? String(err)}`
    );
  }

  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;

  throw new Error(
    `${name}_INVALID: ${name} must be "true" or "false"; got "${raw}". ` +
      `Ops: correct ${name} in env-service for env="${dto.getEnvLabel()}".`
  );
}

/**
 * Deterministic S2S transport for tests.
 *
 * Goal:
 * - Keep the runner dumb and reliable.
 * - Let handler tests exercise SvcClient.call() without needing live downstream services.
 *
 * Behavior:
 * - Default: echo the request body back as a 200 JSON response (works for bag calls).
 * - Optional targeted fallbacks can be added as we discover real needs.
 */
class TestRunnerDeterministicTransport implements ISvcClientTransport {
  public async execute(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    requestId: string;
    targetSlug: string;
    logPrefix: string;
  }): Promise<RawResponse> {
    const bodyText =
      typeof request.body === "string" && request.body.trim().length > 0
        ? request.body
        : JSON.stringify({ items: [] });

    return {
      status: 200,
      bodyText,
      headers: { "content-type": "application/json" },
    };
  }
}

class TestRunnerApp extends AppBase {
  /** Concrete per-service DTO registry (explicit, no barrels). */
  private readonly registry: Registry;

  constructor(opts: CreateAppOptions) {
    // Initialize logger first so all subsequent boot logs have proper context.
    setLoggerEnv(opts.envDto);

    const s2sMocksEnabled = requireBoolVarFromDto(opts.envDto, "S2S_MOCKS");
    const svcClientTransport = s2sMocksEnabled
      ? new TestRunnerDeterministicTransport()
      : undefined;

    super({
      service: opts.slug,
      version: opts.version,
      envLabel: opts.envLabel,
      envDto: opts.envDto,
      envReloader: opts.envReloader,

      // MOS-only: no DB boot, no ensureIndexes.
      checkDb: false,

      // Explicit-only S2S mocks switch (rails decision; never inferred elsewhere).
      s2sMocksEnabled,

      // When mocks are enabled, inject deterministic transport (wins over block/fetch).
      svcClientTransport,
    });

    this.registry = new Registry();
  }

  /** ADR-0049: Base-typed accessor so handlers/controllers stay decoupled. */
  public override getDtoRegistry(): IDtoRegistry {
    return this.registry;
  }

  /** Mount service routes as one-liners under the versioned base. */
  protected override mountRoutes(): void {
    const base = this.healthBasePath(); // `/api/<slug>/v<version>`
    if (!base) {
      this.log.error({ reason: "no_base" }, "Failed to derive base path");
      throw new Error("Base path missing — check AppBase.healthBasePath()");
    }

    const r: Router = buildTestRunnerRouter(this);
    this.app.use(base, r);
    this.log.info({ base, env: this.getEnvLabel() }, "routes mounted");
  }
}

/** Public factory: constructs, boots, and returns the Express instance holder. */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new TestRunnerApp(opts);
  await app.boot();
  return { app: app.instance };
}
