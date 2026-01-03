// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.delete.onFailure.test.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-40 (Handler Test Design — Build-a-test-guide)
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0047 (DtoBag & Views)
 * - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 * - ADR-0057 (Shared SvcClient for S2S Calls)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 *
 * Purpose:
 * - Handler-level tests for S2sUserDeleteOnFailureHandler.
 *
 * Contract for this test module:
 * - If a prior test stored a created userId, we attempt rollback delete.
 * - If no userId is present (prior test failed / skipped), we PASS and no-op.
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
 *
 * ADR-0094 alignment:
 * - No semantics via ctx flags.
 * - Inner/outer try/catch/finally.
 * - Deterministic outcome via TestScenarioStatus + TestScenarioFinalizer.
 * - Assertions are recorded (do not throw) to avoid misclassifying as infra failure.
 */

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDtoRegistry as UserDtoRegistryCtor } from "@nv/shared/dto/registry/user.dtoRegistry";

import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";
import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";

type UserBag = DtoBag<UserDto>;

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

// ───────────────────────────────────────────
// Shared handoff (process-local)
// ───────────────────────────────────────────
const SHARED_SLOT_KEY = "auth.signup.createdUserId";

function getSharedStore(): Record<string, any> {
  const g = globalThis as any;
  if (!g.__nv_handler_test_shared) g.__nv_handler_test_shared = {};
  return g.__nv_handler_test_shared as Record<string, any>;
}

function tryGetCreatedUserIdFromShared(): string | undefined {
  const store = getSharedStore();
  const v = store[SHARED_SLOT_KEY];

  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return undefined;
}

// ───────────────────────────────────────────
// DTO/bag helper
// ───────────────────────────────────────────
function buildUserBagForRollback(
  signupUserId: string,
  requestId: string
): UserBag {
  const registry = new UserDtoRegistryCtor();

  // Registry-minted happy DTO keeps this stable and avoids ad-hoc DTO shaping.
  const dto = registry.getTestDto("happy") as unknown as UserDto;

  // This compensator expects the edge bag to contain the same user with the same id.
  dto.setIdOnce?.(signupUserId);

  const { bag } = BagBuilder.fromDtos([dto], {
    requestId,
    limit: 1,
    total: 1,
    cursor: null,
  });

  return bag as UserBag;
}

// ───────────────────────────────────────────
// Small readers (avoid importing rails helpers)
// ───────────────────────────────────────────
function readHttpStatus(ctx: any): number {
  const v = ctx.get("response.status") ?? ctx.get("status") ?? 200;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 200;
}

function readHandlerStatus(ctx: any): string {
  const v = ctx.get("handlerStatus");
  return typeof v === "string" ? v : "ok";
}

// ───────────────────────────────────────────
// Legacy mapping (status → HandlerTestResult)
// ───────────────────────────────────────────
function makeResultFromStatus(input: {
  status: TestScenarioStatus;
  testId: string;
  name: string;
  expectedError: boolean;
  ctx?: any;
}): HandlerTestResult {
  const out = input.status.outcome();
  const rails = input.status.rails();

  const handlerStatus =
    rails?.handlerStatus ?? (input.ctx ? readHandlerStatus(input.ctx) : "ok");
  const httpStatus =
    rails?.httpStatus ?? (input.ctx ? readHttpStatus(input.ctx) : 200);

  // If status didn’t finalize (should never happen), treat as infrastructure bug.
  if (!out) {
    return {
      testId: input.testId,
      name: input.name,
      outcome: "failed",
      expectedError: input.expectedError,
      assertionCount: 0,
      failedAssertions: [
        "TestScenarioStatus did not finalize an outcome (infrastructure bug).",
      ],
      errorMessage:
        "TestScenarioStatus did not finalize an outcome (infrastructure bug).",
      durationMs: 0,
      railsVerdict: "test_bug",
      railsStatus: httpStatus,
      railsHandlerStatus: handlerStatus,
      railsResponseStatus: httpStatus,
    };
  }

  const failedAssertions = input.status.assertionFailures?.() ?? [];

  return {
    testId: input.testId,
    name: input.name,
    outcome: out.color === "green" ? "passed" : "failed",
    expectedError: input.expectedError,
    assertionCount: failedAssertions.length,
    failedAssertions,
    errorMessage: failedAssertions.length ? failedAssertions[0] : undefined,
    durationMs: 0,
    railsVerdict: out.color === "green" ? "ok" : "rails_error",
    railsStatus: httpStatus,
    railsHandlerStatus: handlerStatus,
    railsResponseStatus: httpStatus,
  };
}

// ───────────────────────────────────────────
// ADR-0094 scenario runner helper
// ───────────────────────────────────────────
async function runScenario(input: {
  deps: any;
  testId: string;
  name: string;

  expectedMode: "success" | "failure";
  expectedHttpStatus?: number;

  createdUserId?: string;
}): Promise<HandlerTestResult> {
  const status = createTestScenarioStatus({
    scenarioId: input.testId,
    scenarioName: input.name,
    expected: input.expectedMode,
  });

  const expectedErrorMeta = input.expectedMode === "failure";

  // If no created userId is available: PASS and no-op (your contract).
  if (!input.createdUserId) {
    status.addNote(
      "no created userId was available; skipping rollback delete (not a failure)"
    );
    TestScenarioFinalizer.finalize({ status, ctx: undefined });
    return makeResultFromStatus({
      status,
      testId: input.testId,
      name: input.name,
      expectedError: false,
      ctx: undefined,
    });
  }

  let ctx: any | undefined;

  try {
    try {
      const requestId = `req-${input.testId}`;

      ctx = input.deps.makeScenarioCtx({
        requestId,
        dtoType: "user",
        op: "s2s.user.delete.onFailure",
      });

      // Put pipeline into a failure posture so compensator runs.
      ctx.set("handlerStatus", "error");
      ctx.set("status", 502);

      // Upstream status seeds: user created, user-auth failed.
      ctx.set("signup.userCreateStatus", {
        ok: true,
        userId: input.createdUserId,
      } satisfies UserCreateStatus);

      ctx.set("signup.userAuthCreateStatus", {
        ok: false,
        code: "AUTH_SIGNUP_USER_AUTH_CREATE_FAILED",
        message: "forced failure for rollback test",
      } satisfies UserAuthCreateStatus);

      ctx.set("signup.userId", input.createdUserId);

      // Handler requires ctx["bag"] for the delete call; provide a real bag.
      ctx.set("bag", buildUserBagForRollback(input.createdUserId, requestId));

      await input.deps.step.execute(ctx);

      // Assertions: record failures; do not throw.
      const hs = readHandlerStatus(ctx);
      if (hs !== "error") {
        status.recordAssertionFailure(
          `Expected handlerStatus="error" after rollback attempt, got "${hs}".`
        );
      }

      // On rollback success: handler stamps signup.userRolledBack === true and keeps 502.
      const rolledBack = ctx.get("signup.userRolledBack");
      if (rolledBack !== true) {
        status.recordAssertionFailure(
          "signup.userRolledBack should be true on rollback success."
        );
      }

      if (typeof input.expectedHttpStatus === "number") {
        const httpStatus = readHttpStatus(ctx);
        if (httpStatus !== input.expectedHttpStatus) {
          status.recordAssertionFailure(
            `Expected httpStatus=${input.expectedHttpStatus} but got httpStatus=${httpStatus}.`
          );
        }
      }
    } catch (err: any) {
      status.recordInnerCatch(err);
    } finally {
      TestScenarioFinalizer.finalize({ status, ctx });
    }
  } catch (err: any) {
    status.recordOuterCatch(err);
  } finally {
    TestScenarioFinalizer.finalize({ status, ctx });
  }

  return makeResultFromStatus({
    status,
    testId: input.testId,
    name: input.name,
    expectedError: expectedErrorMeta,
    ctx,
  });
}

// ───────────────────────────────────────────
// ScenarioRunner entrypoint
// ───────────────────────────────────────────
export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "auth.signup.s2s.user.delete.onFailure.rollback",
      name: "auth.signup: S2sUserDeleteOnFailureHandler rolls back user when auth creation fails (or skips if no userId)",
      shortCircuitOnFail: false,
      expectedError: true,

      async run(): Promise<HandlerTestResult> {
        const createdUserId = tryGetCreatedUserIdFromShared();

        // This scenario is “failure expected” because the compensator preserves
        // the pipeline error state by design (502 on rollback-ok, 500 on rollback-fail).
        return runScenario({
          deps,
          testId: "auth.signup.s2s.user.delete.onFailure.rollback",
          name: "auth.signup: S2sUserDeleteOnFailureHandler rolls back user when auth creation fails (or skips if no userId)",
          expectedMode: createdUserId ? "failure" : "success",
          expectedHttpStatus: createdUserId ? 502 : undefined,
          createdUserId,
        });
      },
    },
  ];
}
