// backend/services/test-runner/src/controllers/test-runner.run.controller/pipelines/run.handlerPipeline/code.guard.dbStateAndMockMode.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - LDD-00/02/24 (Env-backed services, boot & persistence rails)
 * - LDD-29 (Error semantics & operator guidance)
 * - ADR-0070 (DbDto/MemDto hierarchy — DB_STATE usage) [pending refinement]
 * - ADR-0072 (Edge Mode Factory — Root Env Switches; mock vs real edges)
 *
 * Purpose:
 * - First handler in the test-runner pipeline that **hard-gates execution**
 *   based on DB_STATE and DB_MOCKING.
 * - Prevents the test-runner from:
 *   • ever running against prod DB_STATE, and
 *   • running non-mocked writes against dev/stage/prod.
 * - On success, computes mockMode and stashes it into ctx["mockMode"] for
 *   downstream handlers (DbWriter edge-mode, etc.).
 *
 * Invariants:
 * - DB_STATE and DB_MOCKING **must** be defined in env-service.
 * - DB_STATE="prod"/"production" ⇒ hard block, regardless of DB_MOCKING.
 * - If DB_MOCKING === true  ⇒ any non-prod DB_STATE is allowed.
 * - If DB_MOCKING === false ⇒ DB_STATE **cannot** be dev/development/stage/staging/prod/production
 *   (must be a dedicated test state, e.g. "smoke", "testsuite", "ci").
 * - On failure:
 *   • handlerStatus="error"
 *   • Problem+JSON is attached via HandlerBase.failWithError().
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

type DbMockResolveResult =
  | { ok: true; mockMode: boolean }
  | { ok: false; detail: string };

function resolveDbMockMode(
  dbStateRaw: string,
  dbMockingRaw: string
): DbMockResolveResult {
  const dbState = (dbStateRaw ?? "").trim();
  const dbMocking = (dbMockingRaw ?? "").trim();

  if (!dbState) {
    return {
      ok: false,
      detail:
        "DB_STATE is missing in env-service configuration for this service. Ops: add DB_STATE to env-service for this (env, slug, version) before running the test-runner.",
    };
  }

  if (!dbMocking) {
    return {
      ok: false,
      detail:
        'DB_MOCKING is missing in env-service configuration for this service. Ops: add DB_MOCKING="true" or "false" to env-service for this (env, slug, version) before running the test-runner.',
    };
  }

  const state = dbState.toLowerCase();
  const mockFlag = dbMocking.toLowerCase();

  // Hard block: prod is never allowed for the test-runner
  if (state === "prod" || state === "production") {
    return {
      ok: false,
      detail:
        'DB_STATE is set to "prod" for this service. The test-runner will not execute against a production DB_STATE, regardless of DB_MOCKING. Ops: point DB_STATE to a non-prod, test-safe database (e.g. "smoke" or "testsuite") before re-running.',
    };
  }

  let mockMode: boolean;
  if (mockFlag === "true") {
    mockMode = true;
  } else if (mockFlag === "false") {
    mockMode = false;
  } else {
    return {
      ok: false,
      detail:
        `DB_MOCKING="${dbMockingRaw}" is invalid. Expected "true" or "false". ` +
        'Ops: update env-service so DB_MOCKING is exactly "true" or "false" for this service.',
    };
  }

  // If mocking is enabled, any non-prod state is allowed.
  if (mockMode) {
    return { ok: true, mockMode: true };
  }

  // Non-mocked mode: DB_STATE must **not** be dev/stage/prod.
  const forbiddenNonMockStates = new Set([
    "dev",
    "development",
    "stage",
    "staging",
    "prod",
    "production",
  ]);

  if (forbiddenNonMockStates.has(state)) {
    return {
      ok: false,
      detail:
        `DB_STATE="${dbStateRaw}" is not allowed when DB_MOCKING=false. ` +
        `Non-mocked test-runner execution must target a dedicated test database (e.g. "smoke", "testsuite", or "ci"), not dev/stage/prod. ` +
        "Ops: update DB_STATE to a test-only value and/or set DB_MOCKING=true for safe mock-mode runs.",
    };
  }

  // Safe non-mocked state (e.g. "smoke", "testsuite", "ci")
  return { ok: true, mockMode: false };
}

export class CodeGuardDbStateAndMockModeHandler extends HandlerBase {
  /**
   * Handler naming convention: code.<primaryFunction>
   * (kept for external callers / logs that expect handlerName()).
   */
  public handlerName(): string {
    return "code.testRunner.guardDbStateAndMockMode";
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Guard test-runner execution based on DB_STATE and DB_MOCKING, computing mockMode for downstream handlers.";
  }

  /**
   * Core handler logic; HandlerBase.run() is the framework entrypoint.
   */
  protected async execute(): Promise<void> {
    const ctx: HandlerContext = this.ctx;
    const requestId = this.getRequestId();

    // Strict env access; both vars are required and wired via env-service.
    const dbState = this.getVar("DB_STATE", true);
    const dbMocking = this.getVar("DB_MOCKING", true);

    const result = resolveDbMockMode(dbState, dbMocking);

    if (!result.ok) {
      // Fine-grained, structured error via HandlerBase.failWithError().
      this.failWithError({
        httpStatus: 500,
        title: "unsafe_db_configuration_for_test_runner",
        detail: result.detail,
        stage: `${this.handlerPurpose()}:validation`,
        requestId,
        origin: {
          handler: this.handlerName(),
          method: "execute",
        },
        issues: [{ dbState, dbMocking }],
        logMessage:
          "test-runner: blocking execution due to unsafe DB_STATE/DB_MOCKING configuration.",
        logLevel: "error",
      });

      return;
    }

    // Success: stash mockMode for downstream handlers (DbWriter edge-mode, etc.)
    const mockMode = result.mockMode;
    ctx.set("mockMode", mockMode);

    this.log.info(
      {
        event: "db_state_and_mock_mode_validated",
        handler: this.handlerName(),
        requestId,
        dbState,
        dbMocking,
        mockMode,
        slug: this.safeServiceSlug(),
        pipeline: this.safePipeline(),
      },
      "test-runner: DB_STATE/DB_MOCKING configuration validated; continuing pipeline."
    );
  }
}
