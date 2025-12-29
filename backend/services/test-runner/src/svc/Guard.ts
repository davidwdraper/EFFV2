// backend/services/test-runner/src/svc/Guard.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0086 (Posture-Safe DTO Mint Capability — registry-free mint surface)
 *
 * Purpose:
 * - Hard-stop the run when DB_STATE / DB_MOCKS / S2S_MOCKS are invalid.
 *
 * Invariants:
 * - Single source of truth is SvcRuntime (no svcEnv in ctx; no controller getSvcEnv()).
 * - No process.env access.
 * - No defaults: all vars must be explicitly set (SvcRuntime.getVar is strict).
 * - Invalid matrix must fail-fast:
 *     (DB_MOCKS=true,  S2S_MOCKS=false) => INVALID
 * - Safe integration is allowed only when DB_STATE != "prod".
 */

import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

export type GuardConfig = {
  dbState: string;
  dbMocks: boolean;
  s2sMocks: boolean;
};

export class Guard {
  public constructor(private readonly controller: ControllerBase) {}

  public execute(): GuardConfig {
    const rt = this.controller.getRuntime();

    // DB_STATE is runtime identity (rails). Do not read it from vars.
    const dbState = (rt.getDbState() ?? "").trim();
    if (!dbState) {
      throw new Error(
        "FAILED_GUARD: rt.getDbState() returned empty. Ops: fix runtime identity wiring."
      );
    }

    // Explicit-only vars. SvcRuntime.getVar() is strict and fail-fast.
    const dbMocks = this.mustBool(rt.getVar("DB_MOCKS"), "DB_MOCKS");
    const s2sMocks = this.mustBool(rt.getVar("S2S_MOCKS"), "S2S_MOCKS");

    // DB_STATE must never be prod for test-runner execution.
    if (dbState.toLowerCase() === "prod") {
      throw new Error(
        "FAILED_GUARD: DB_STATE='prod' is not allowed for test-runner execution."
      );
    }

    // Invalid matrix: DB mocked but S2S real.
    if (dbMocks === true && s2sMocks === false) {
      throw new Error(
        "FAILED_GUARD: Invalid mock matrix: DB_MOCKS=true with S2S_MOCKS=false is forbidden."
      );
    }

    return { dbState, dbMocks, s2sMocks };
  }

  private mustBool(raw: string, key: string): boolean {
    const s = (raw ?? "").trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;

    throw new Error(
      `FAILED_GUARD: Env var '${key}' must be 'true' or 'false' (got '${
        s || "<empty>"
      }').`
    );
  }
}
