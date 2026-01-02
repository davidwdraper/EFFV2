// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.create.test.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-40 (Handler Test Design — Build-a-test-guide)
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0047 (DtoBag & Views)
 * - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 * - ADR-0057 (Shared SvcClient for S2S Calls)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Define handler-level tests for S2sUserCreateHandler.
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
 *
 * Note:
 * - UserDto.givenName / lastName validation forbids digits.
 *   Keep names strictly alphabetic; use email for uniqueness.
 *
 * Shared test handoff:
 * - On happy-path success, stash created userId for follow-on rollback tests:
 *   • ctx["test.shared.userId"]
 *   • globalThis.__nv_handler_test_shared["auth.signup.createdUserId"]
 */

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDtoRegistry as UserDtoRegistryCtor } from "@nv/shared/dto/registry/user.dtoRegistry";
import { newUuid } from "@nv/shared/utils/uuid";

type UserBag = DtoBag<UserDto>;

type UserCreateStatus =
  | { ok: true; userId?: string }
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
// Shared test handoff (process-local)
// ───────────────────────────────────────────
const SHARED_SLOT_KEY = "auth.signup.createdUserId";

function getSharedStore(): Record<string, any> {
  const g = globalThis as any;
  if (!g.__nv_handler_test_shared) g.__nv_handler_test_shared = {};
  return g.__nv_handler_test_shared as Record<string, any>;
}

function stashCreatedUserId(ctx: any, userId: string): void {
  if (typeof userId !== "string" || userId.trim().length === 0) return;

  // Best-effort: ctx (only helps if runner reuses ctx across modules)
  try {
    if (ctx && typeof ctx.set === "function") {
      ctx.set("test.shared.userId", userId);
    }
  } catch {
    // ignore
  }

  // Reliable: same Node process shared store
  const store = getSharedStore();
  store[SHARED_SLOT_KEY] = userId;
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
    (typeof s.status === "number" && s.status >= 500) ||
    (typeof s.responseStatus === "number" && s.responseStatus >= 500)
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
// DTO/bag helper
// ───────────────────────────────────────────
function buildUserBag(
  signupUserId: string,
  requestId: string,
  mutate?: (dto: UserDto) => void
): UserBag {
  const registry = new UserDtoRegistryCtor();

  // ✅ Registry-minted happy DTO (sidecar JSON hydrated + validated + collection seeded)
  const dto = registry.getTestDto("happy") as unknown as UserDto;

  // Optional per-scenario tweaks (uniqueness, forcing missing, etc.)
  if (mutate) mutate(dto);

  // Match pipeline behavior: canonical UUIDv4 id applied once.
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
// Scenario runner helper
// ───────────────────────────────────────────
async function runScenario(input: {
  deps: any; // ScenarioDeps does not exist in this repo; keep loose.
  testId: string;
  name: string;
  expectedError: boolean;
  seed: {
    requestId: string;
    dtoType: string;
    op: string;
    signupUserId: string;
    bag: any;
  };
  expectOkStatus: boolean;
}): Promise<HandlerTestResult> {
  const startedAt = Date.now();
  const a: Assert = { count: 0, failed: [] };

  try {
    const ctx = input.deps.makeScenarioCtx({
      requestId: input.seed.requestId,
      dtoType: input.seed.dtoType,
      op: input.seed.op,
    });

    ctx.set("signup.userId", input.seed.signupUserId);
    ctx.set("bag", input.seed.bag);

    // Execute handler in production shape (runner step).
    await input.deps.step.execute(ctx);

    const snap = railsSnapshot(ctx);
    const railsError = isRailsError(snap);

    assertEq(
      a,
      railsError,
      input.expectedError,
      input.expectedError
        ? "expected rails error but handler succeeded"
        : "unexpected rails error"
    );

    const expectedHandlerStatus = input.expectedError ? "error" : "ok";
    assertEq(
      a,
      String(snap.handlerStatus ?? ""),
      expectedHandlerStatus,
      `handlerStatus should be "${expectedHandlerStatus}"`
    );

    const status = ctx.get("signup.userCreateStatus") as
      | UserCreateStatus
      | undefined;

    if (input.expectOkStatus) {
      assertOk(
        a,
        !!status && status.ok === true,
        "signup.userCreateStatus.ok should be true on happy path"
      );
      if (status && status.ok === true) {
        assertEq(
          a,
          String(status.userId ?? ""),
          input.seed.signupUserId,
          "signup.userCreateStatus.userId should mirror ctx['signup.userId']"
        );

        // ✅ Handoff for rollback tests (best-effort ctx + reliable process-local)
        stashCreatedUserId(ctx, input.seed.signupUserId);
      }
    } else {
      assertOk(
        a,
        !!status && status.ok === false,
        "signup.userCreateStatus.ok should be false on error paths"
      );
      if (status && status.ok === false) {
        assertOk(
          a,
          typeof status.code === "string" && status.code.length > 0,
          "signup.userCreateStatus.code should be populated on error paths"
        );
        assertOk(
          a,
          typeof status.message === "string" && status.message.length > 0,
          "signup.userCreateStatus.message should be populated on error paths"
        );
      }
    }

    const finishedAt = Date.now();
    return {
      testId: input.testId,
      name: input.name,
      outcome: a.failed.length === 0 ? "passed" : "failed",
      expectedError: input.expectedError,
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
      railsStatus: undefined,
      railsHandlerStatus: undefined,
      railsResponseStatus: undefined,
    };
  }
}

// ───────────────────────────────────────────
// ScenarioRunner entrypoint
// ───────────────────────────────────────────
export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "auth.signup.s2s.user.create.happy",
      name: "auth.signup: S2sUserCreateHandler happy path — user.create succeeds",
      shortCircuitOnFail: true,
      expectedError: false,
      async run(): Promise<HandlerTestResult> {
        const requestId = "req-auth-s2s-user-create-happy";
        const signupUserId = newUuid();

        // Keep names strictly alphabetic; uniqueness goes in email.
        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth S S");
          dto.setLastName?.("UserCreate");
          dto.setEmail?.(`auth.s2s.user.create+${signupUserId}@example.com`);
        });

        return runScenario({
          deps,
          testId: "auth.signup.s2s.user.create.happy",
          name: "auth.signup: S2sUserCreateHandler happy path — user.create succeeds",
          expectedError: false,
          seed: {
            requestId,
            dtoType: "user",
            op: "s2s.user.create",
            signupUserId,
            bag,
          },
          expectOkStatus: true,
        });
      },
    },
    {
      id: "auth.signup.s2s.user.create.badEnvelope",
      name: "auth.signup: S2sUserCreateHandler rails on malformed user.create envelope",
      shortCircuitOnFail: false,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const requestId = "req-auth-s2s-user-create-bad-envelope";
        const signupUserId = newUuid();

        const goodBag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth S S");
          dto.setLastName?.("BadEnvelope");
          dto.setEmail?.(
            `auth.s2s.user.create.badenv+${signupUserId}@example.com`
          );
        });

        // Corrupt the envelope shape: wrong item structure.
        const itemsArray =
          typeof (goodBag as any).items === "function"
            ? Array.from((goodBag as any).items())
            : [];
        const firstItem = itemsArray[0] ?? {};

        const badEnvelope = {
          meta: (goodBag as any).meta,
          items: [
            {
              payload: (firstItem as any).data ?? firstItem,
            },
          ],
        };

        return runScenario({
          deps,
          testId: "auth.signup.s2s.user.create.badEnvelope",
          name: "auth.signup: S2sUserCreateHandler sad path — malformed envelope",
          expectedError: true,
          seed: {
            requestId,
            dtoType: "user",
            op: "s2s.user.create",
            signupUserId,
            bag: badEnvelope as unknown as UserBag,
          },
          expectOkStatus: false,
        });
      },
    },
    {
      id: "auth.signup.s2s.user.create.missingFields",
      name: "auth.signup: S2sUserCreateHandler rails when givenName/lastName/email are missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const requestId = "req-auth-s2s-user-create-missing-fields";
        const signupUserId = newUuid();

        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          // Start with valid happy data, then force missing/empty fields.
          // (Setter validation is not requested here; the handler/rails should reject.)
          dto.setGivenName?.("");
          dto.setLastName?.("");
          dto.setEmail?.("");
        });

        return runScenario({
          deps,
          testId: "auth.signup.s2s.user.create.missingFields",
          name: "auth.signup: S2sUserCreateHandler sad path — missing givenName/lastName/email",
          expectedError: true,
          seed: {
            requestId,
            dtoType: "user",
            op: "s2s.user.create",
            signupUserId,
            bag,
          },
          expectOkStatus: false,
        });
      },
    },
  ];
}
