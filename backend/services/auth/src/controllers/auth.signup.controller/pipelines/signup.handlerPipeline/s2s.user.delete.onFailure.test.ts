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
 * - ADR-0095 (Happy-Path-Only testing)
 *
 * Purpose:
 * - Happy-path compatible smoke test for S2sUserDeleteOnFailureHandler.
 *
 * ADR-0095 interpretation for compensators (locked):
 * - Single scenario ("HappyPath") where the handler's own contract must succeed:
 *   - If a created userId exists, delete it (rollback) and return handlerStatus=ok.
 *   - If no created userId exists, PASS and no-op (still "HappyPath").
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
 *
 * ADR-0094 alignment:
 * - No semantics via ctx flags (beyond production-shaped ctx seeding).
 * - Inner/outer try/catch/finally.
 * - Deterministic outcome via TestScenarioStatus + TestScenarioFinalizer.
 * - Assertions are recorded (do not throw).
 */

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDtoRegistry as UserDtoRegistryCtor } from "@nv/shared/dto/registry/user.dtoRegistry";

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

type ScenarioDepsLike = {
  step: { execute: (scenarioCtx: any) => Promise<void> };
  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
};

type UserBag = DtoBag<UserDto>;

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

// ───────────────────────────────────────────
// Shared handoff (process-local) from s2s.user.create.test.ts
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
// ScenarioRunner entrypoint
// ───────────────────────────────────────────
export async function getScenarios(deps: ScenarioDepsLike): Promise<any[]> {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: S2sUserDeleteOnFailureHandler rolls back user when auth creation fails (or skips if no userId)",
      shortCircuitOnFail: false,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: S2sUserDeleteOnFailureHandler rolls back user when auth creation fails (or skips if no userId)",
          expected: "success",
        });

        const createdUserId = tryGetCreatedUserIdFromShared();

        // Contract: if no created userId exists, PASS and no-op.
        if (!createdUserId) {
          status.addNote(
            "no created userId was available; skipping rollback delete (not a failure)"
          );
          TestScenarioFinalizer.finalize({ status, ctx: undefined });
          return status;
        }

        let ctx: any | undefined;

        // Outer try/catch protects runner integrity (ADR-0094).
        try {
          const requestId = "req-auth-s2s-user-delete-onFailure-happy";

          ctx = localDeps.makeScenarioCtx({
            requestId,
            dtoType: "user",
            op: "s2s.user.delete.onFailure",
          });

          // Seed ONLY the production-shaped inputs the handler needs.
          // Do NOT pre-poison handlerStatus/response.status; the handler must own its outcome.
          //
          // Upstream status seeds: user created, user-auth failed.
          // This explains why the compensator is running without turning this handler into a "failure".
          ctx.set("signup.userCreateStatus", {
            ok: true,
            userId: createdUserId,
          } satisfies UserCreateStatus);

          ctx.set("signup.userAuthCreateStatus", {
            ok: false,
            code: "AUTH_SIGNUP_USER_AUTH_CREATE_FAILED",
            message: "forced failure for rollback test",
          } satisfies UserAuthCreateStatus);

          ctx.set("signup.userId", createdUserId);

          // Handler requires ctx["bag"] for the delete call; provide a real bag.
          ctx.set("bag", buildUserBagForRollback(createdUserId, requestId));

          // Inner try/catch wraps ONLY handler execution (ADR-0094).
          try {
            await localDeps.step.execute(ctx);

            // Assertions: record failures; do not throw.
            const hs = readHandlerStatus(ctx);
            if (hs !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" after successful rollback/no-op, got "${hs}".`
              );
            }

            // On rollback success: handler stamps signup.userRolledBack === true.
            const rolledBack = ctx.get("signup.userRolledBack");
            if (rolledBack !== true) {
              status.recordAssertionFailure(
                "signup.userRolledBack should be true on rollback success."
              );
            }

            // HTTP status should be success for the handler-level contract.
            // (Tighten to a single value once we confirm the handler's intended status code.)
            const httpStatus = readHttpStatus(ctx);
            if (httpStatus !== 200 && httpStatus !== 204) {
              status.recordAssertionFailure(
                `Expected httpStatus=200 or 204 but got httpStatus=${httpStatus}.`
              );
            }
          } catch (err: any) {
            status.recordInnerCatch(err);
          }
        } catch (err: any) {
          status.recordOuterCatch(err);
        } finally {
          // Deterministic finalization exactly once (no double-finalize noise).
          TestScenarioFinalizer.finalize({ status, ctx });
        }

        return status;
      },
    },
  ];
}
