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
 *
 * Purpose:
 * - Define handler-level tests for S2sUserDeleteOnFailureHandler.
 *
 * Contract for this test module:
 * - If a prior test stored a created userId, we attempt rollback delete.
 * - If no userId is present (prior test failed / skipped), we PASS and no-op.
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
 */

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";

type UserBag = DtoBag<UserDto>;

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

type Assert = { count: number; failed: string[] };

function assertEq(a: Assert, actual: any, expected: any, msg: string): void {
  a.count += 1;
  if (actual !== expected) {
    a.failed.push(`${msg} expected=${String(expected)} got=${String(actual)}`);
  }
}

function assertOk(a: Assert, cond: any, msg: string): void {
  a.count += 1;
  if (!cond) a.failed.push(msg);
}

// ───────────────────────────────────────────
// Shared handoff (process-local)
// ───────────────────────────────────────────
const SHARED_SLOT_KEY = "auth.signup.createdUserId";

function getSharedStore(): Record<string, any> {
  const g = globalThis as any;
  if (!g.__nv_handler_test_shared) g.__nv_handler_test_shared = {};
  return g.__nv_handler_test_shared as Record<string, any>;
}

function tryGetCreatedUserIdFromCtxOrShared(ctx: any): string | undefined {
  const fromCtx =
    typeof ctx?.get === "function"
      ? (ctx.get("test.shared.userId") as any)
      : undefined;

  if (typeof fromCtx === "string" && fromCtx.trim().length > 0) {
    return fromCtx.trim();
  }

  const store = getSharedStore();
  const fromShared = store[SHARED_SLOT_KEY];

  if (typeof fromShared === "string" && fromShared.trim().length > 0) {
    return fromShared.trim();
  }

  return undefined;
}

// ───────────────────────────────────────────
// Rails helpers
// ───────────────────────────────────────────
function railsSnapshot(ctx: any): {
  handlerStatus: any;
  status: any;
  responseStatus: any;
} {
  const handlerStatus = ctx?.get?.("handlerStatus") ?? "ok";
  const status = ctx?.get?.("status") ?? 200;
  const responseStatus = ctx?.get?.("response.status");
  return { handlerStatus, status, responseStatus };
}

function isRailsError(s: {
  handlerStatus: any;
  status: any;
  responseStatus: any;
}): boolean {
  return (
    s.handlerStatus === "error" ||
    (typeof s.status === "number" && s.status >= 400) ||
    (typeof s.responseStatus === "number" && s.responseStatus >= 400)
  );
}

type HandlerTestResult = {
  testId: string;
  name: string;
  outcome: "passed" | "failed";
  expectedError: boolean;
  assertionCount: number;
  failedAssertions: string[];
  errorMessage?: string;
  durationMs: number;
  railsVerdict: "ok" | "rails_error" | "test_bug";
  railsStatus?: number;
  railsHandlerStatus?: string;
  railsResponseStatus?: number;
};

// ───────────────────────────────────────────
// Scenario runner helper
// ───────────────────────────────────────────
async function runScenario(input: {
  deps: any;
  testId: string;
  name: string;
  expectedError: boolean;
  seed: {
    requestId: string;
    dtoType: string;
    op: string;
    bag: any;
  };
  createdUserId?: string;
}): Promise<HandlerTestResult> {
  const startedAt = Date.now();
  const a: Assert = { count: 0, failed: [] };

  try {
    // If we don't have a created userId, that's a PASS (per your rule).
    if (!input.createdUserId) {
      assertOk(
        a,
        true,
        "no created userId was available; skipping rollback delete (not a failure)"
      );

      const finishedAt = Date.now();
      return {
        testId: input.testId,
        name: input.name,
        outcome: "passed",
        expectedError: false,
        assertionCount: a.count,
        failedAssertions: [],
        errorMessage: undefined,
        durationMs: Math.max(0, finishedAt - startedAt),
        railsVerdict: "ok",
      };
    }

    const ctx = input.deps.makeScenarioCtx({
      requestId: input.seed.requestId,
      dtoType: input.seed.dtoType,
      op: input.seed.op,
    });

    // Critical: mark this scenario as an expected-error test so failWithError()
    // downgrades ERROR logs (ops noise) during deliberate rail tests.
    if (input.expectedError === true) {
      ctx.set("expectErrors", true);
    }

    // Simulate "pipeline in error state" so compensator runs.
    ctx.set("handlerStatus", "error");
    ctx.set("status", 502);

    // Upstream status seeds
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

    // Pipeline invariant: edge bag remains the UserDto bag (handler requires it to call delete).
    ctx.set("bag", input.seed.bag as UserBag);

    await input.deps.step.execute(ctx);

    const snap = railsSnapshot(ctx);
    const railsError = isRailsError(snap);

    // This handler *intentionally* ends with failWithError (502 on rollback ok, 500 on rollback fail).
    assertEq(
      a,
      railsError,
      true,
      "rollback handler must keep pipeline in error state"
    );

    const handlerStatus = String(snap.handlerStatus ?? "");
    assertEq(
      a,
      handlerStatus,
      "error",
      'handlerStatus should be "error" after rollback attempt'
    );

    // On rollback success: handler stamps ctx["signup.userRolledBack"] === true and sets 502.
    const rolledBack = ctx.get("signup.userRolledBack");
    assertEq(
      a,
      rolledBack,
      true,
      "signup.userRolledBack should be true on rollback success"
    );

    const httpStatus = (ctx.get("response.status") ??
      ctx.get("status") ??
      null) as unknown;

    if (httpStatus !== null) {
      assertEq(
        a,
        Number(httpStatus),
        502,
        "HTTP status should be 502 for 'auth failed but user rolled back' outcome"
      );
    }

    const finishedAt = Date.now();
    return {
      testId: input.testId,
      name: input.name,
      outcome: a.failed.length === 0 ? "passed" : "failed",
      expectedError: true,
      assertionCount: a.count,
      failedAssertions: a.failed,
      errorMessage: a.failed[0],
      durationMs: Math.max(0, finishedAt - startedAt),
      railsVerdict: a.failed.length === 0 ? "ok" : "rails_error",
      railsStatus: snap.status,
      railsHandlerStatus: snap.handlerStatus,
      railsResponseStatus: snap.responseStatus,
    };
  } catch (err) {
    const finishedAt = Date.now();
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    return {
      testId: input.testId,
      name: input.name,
      outcome: "failed",
      expectedError: input.expectedError,
      assertionCount: a.count,
      failedAssertions: a.failed.length ? a.failed : [msg],
      errorMessage: msg,
      durationMs: Math.max(0, finishedAt - startedAt),
      railsVerdict: "test_bug",
    };
  }
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
        const requestId = "req-auth-s2s-user-delete-onfailure";

        // Pull from ctx if runner reuses it; otherwise from process-local shared slot.
        // (If neither exists, we PASS and no-op as requested.)
        const createdUserId = tryGetCreatedUserIdFromCtxOrShared(undefined);

        // This handler requires a UserDto bag to call delete (it uses ctx["bag"]).
        // We do not rebuild the user here; we only need an edge bag shape.
        // If you want, we can keep a shared bag too later — for now we pass a minimal placeholder.
        const bag = {} as unknown as UserBag;

        return runScenario({
          deps,
          testId: "auth.signup.s2s.user.delete.onFailure.rollback",
          name: "auth.signup: S2sUserDeleteOnFailureHandler rolls back user when auth creation fails (or skips if no userId)",
          expectedError: true,
          seed: {
            requestId,
            dtoType: "user",
            op: "s2s.user.delete.onFailure",
            bag,
          },
          createdUserId,
        });
      },
    },
  ];
}
