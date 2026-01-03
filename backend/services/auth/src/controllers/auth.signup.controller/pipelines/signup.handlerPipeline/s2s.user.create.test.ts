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
 * - ADR-0094 (Test Scenario Error Handling and Logging)
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
 *
 * ADR-0094 contract:
 * - No expectErrors anywhere.
 * - Scenario.run returns TestScenarioStatus.
 * - Inner try/catch wraps ONLY handler execution.
 * - Outer try/catch protects runner integrity.
 * - Finalization is deterministic via TestScenarioFinalizer.
 */

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDtoRegistry as UserDtoRegistryCtor } from "@nv/shared/dto/registry/user.dtoRegistry";
import { newUuid } from "@nv/shared/utils/uuid";

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

type UserBag = DtoBag<UserDto>;

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

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
// Scenario runner helper (ADR-0094)
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

async function runScenario(input: {
  deps: any; // ScenarioDeps does not exist in this repo; keep loose.
  testId: string;
  name: string;

  expectedMode: "success" | "failure";
  expectedHttpStatus?: number;

  seedCtx: (ctx: any) => void;
  assertAfter?: (ctx: any, status: TestScenarioStatus) => void;
}): Promise<TestScenarioStatus> {
  const status = createTestScenarioStatus({
    scenarioId: input.testId,
    scenarioName: input.name,
    expected: input.expectedMode,
  });

  let ctx: any | undefined;

  try {
    try {
      ctx = input.deps.makeScenarioCtx({
        requestId: `req-${input.testId}`,
        dtoType: "user",
        op: "s2s.user.create",
      });

      input.seedCtx(ctx);

      await input.deps.step.execute(ctx);

      if (typeof input.expectedHttpStatus === "number") {
        const httpStatus = readHttpStatus(ctx);
        if (httpStatus !== input.expectedHttpStatus) {
          status.recordAssertionFailure(
            `Expected httpStatus=${
              input.expectedHttpStatus
            } but got httpStatus=${httpStatus} (handlerStatus=${readHandlerStatus(
              ctx
            )}).`
          );
        }
      }

      if (input.assertAfter) {
        input.assertAfter(ctx, status);
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

  return status;
}

// ───────────────────────────────────────────
// Assertions (record failures; do not throw)
// ───────────────────────────────────────────

function assertOkStatus(
  ctx: any,
  status: TestScenarioStatus,
  signupUserId: string
): void {
  const s = ctx.get("signup.userCreateStatus") as UserCreateStatus | undefined;

  if (!s || s.ok !== true) {
    status.recordAssertionFailure(
      "signup.userCreateStatus.ok should be true on happy path."
    );
    return;
  }

  if (String(s.userId ?? "") !== String(signupUserId)) {
    status.recordAssertionFailure(
      `signup.userCreateStatus.userId should mirror ctx['signup.userId'] (expected=${signupUserId} got=${String(
        s.userId ?? ""
      )}).`
    );
  }
}

function assertErrorStatus(ctx: any, status: TestScenarioStatus): void {
  const s = ctx.get("signup.userCreateStatus") as UserCreateStatus | undefined;

  if (!s || s.ok !== false) {
    status.recordAssertionFailure(
      "signup.userCreateStatus.ok should be false on error paths."
    );
    return;
  }

  if (typeof s.code !== "string" || s.code.length === 0) {
    status.recordAssertionFailure(
      "signup.userCreateStatus.code should be populated on error paths."
    );
  }

  if (typeof s.message !== "string" || s.message.length === 0) {
    status.recordAssertionFailure(
      "signup.userCreateStatus.message should be populated on error paths."
    );
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

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-user-create-happy";
        const signupUserId = newUuid();

        // Keep names strictly alphabetic; uniqueness goes in email.
        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth");
          dto.setLastName?.("UserCreate");
          dto.setEmail?.(`auth.s2s.user.create+${signupUserId}@example.com`);
        });

        return runScenario({
          deps,
          testId: "auth.signup.s2s.user.create.happy",
          name: "auth.signup: S2sUserCreateHandler happy path — user.create succeeds",
          expectedMode: "success",
          expectedHttpStatus: 200,

          seedCtx: (ctx) => {
            ctx.set("requestId", requestId);
            ctx.set("signup.userId", signupUserId);
            ctx.set("bag", bag);
          },

          assertAfter: (ctx, status) => {
            const handlerStatus = readHandlerStatus(ctx);
            if (handlerStatus !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${handlerStatus}".`
              );
            }

            assertOkStatus(ctx, status, signupUserId);

            // ✅ Handoff for rollback tests (best-effort ctx + reliable process-local)
            stashCreatedUserId(ctx, signupUserId);
          },
        });
      },
    },

    {
      id: "auth.signup.s2s.user.create.badEnvelope",
      name: "auth.signup: S2sUserCreateHandler rails on malformed user.create envelope",
      shortCircuitOnFail: false,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-user-create-bad-envelope";
        const signupUserId = newUuid();

        const goodBag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth");
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
          expectedMode: "failure",
          expectedHttpStatus: 400,

          seedCtx: (ctx) => {
            ctx.set("requestId", requestId);
            ctx.set("signup.userId", signupUserId);
            ctx.set("bag", badEnvelope as unknown as UserBag);
          },

          assertAfter: (ctx, status) => {
            const handlerStatus = readHandlerStatus(ctx);
            if (handlerStatus !== "error") {
              status.recordAssertionFailure(
                `Expected handlerStatus="error" but got "${handlerStatus}".`
              );
            }
            assertErrorStatus(ctx, status);
          },
        });
      },
    },

    {
      id: "auth.signup.s2s.user.create.missingFields",
      name: "auth.signup: S2sUserCreateHandler rails when givenName/lastName/email are missing",
      shortCircuitOnFail: false,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-user-create-missing-fields";
        const signupUserId = newUuid();

        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          // Start with valid happy data, then force missing/empty fields.
          dto.setGivenName?.("");
          dto.setLastName?.("");
          dto.setEmail?.("");
        });

        return runScenario({
          deps,
          testId: "auth.signup.s2s.user.create.missingFields",
          name: "auth.signup: S2sUserCreateHandler sad path — missing givenName/lastName/email",
          expectedMode: "failure",
          expectedHttpStatus: 400,

          seedCtx: (ctx) => {
            ctx.set("requestId", requestId);
            ctx.set("signup.userId", signupUserId);
            ctx.set("bag", bag);
          },

          assertAfter: (ctx, status) => {
            const handlerStatus = readHandlerStatus(ctx);
            if (handlerStatus !== "error") {
              status.recordAssertionFailure(
                `Expected handlerStatus="error" but got "${handlerStatus}".`
              );
            }
            assertErrorStatus(ctx, status);
          },
        });
      },
    },
  ];
}
