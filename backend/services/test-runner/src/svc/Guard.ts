// backend/services/test-runner/src/svc/Guard.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *
 * Purpose:
 * - Hard-stop the run when DB_STATE / DB_MOCKS / S2S_MOCKS are invalid.
 *
 * Invariants:
 * - No process.env access.
 * - No defaults: all vars must be explicitly set.
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
    const svcEnv: any = this.controller.getSvcEnv?.();
    if (!svcEnv || typeof svcEnv.getVar !== "function") {
      throw new Error(
        "FAILED_GUARD: ControllerBase.getSvcEnv().getVar() is unavailable. Rails violation."
      );
    }

    const dbStateRaw = this.mustVar(svcEnv, "DB_STATE");
    const dbMocks = this.mustBool(svcEnv, "DB_MOCKS");
    const s2sMocks = this.mustBool(svcEnv, "S2S_MOCKS");

    const dbState = dbStateRaw.trim();

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

  private mustVar(
    svcEnv: { getVar: (k: string) => string | undefined },
    key: string
  ): string {
    const v = svcEnv.getVar(key);
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`FAILED_GUARD: Missing required env var '${key}'.`);
    }
    return v;
  }

  private mustBool(
    svcEnv: { getVar: (k: string) => string | undefined },
    key: string
  ): boolean {
    const raw = this.mustVar(svcEnv, key).trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(
      `FAILED_GUARD: Env var '${key}' must be 'true' or 'false' (got '${raw}').`
    );
  }
}
