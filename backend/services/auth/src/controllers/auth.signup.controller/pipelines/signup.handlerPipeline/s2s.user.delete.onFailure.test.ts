// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.delete.onFailure.test.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-40 (Handler Test Design — Build-a-test-guide)
 * - ADR-0040 (DTO-Only Persistence; edge → DTO)
 * - ADR-0047 (DtoBag & Views)
 * - ADR-0050 (Wire Bag Envelope — canonical wire id is `_id`)
 * - ADR-0057 (Shared SvcClient for S2S Calls)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0095 (Happy-Path-Only testing)
 *
 * Purpose:
 * - Test-mode cleanup behavior MUST be real:
 *   - If a created userId exists (from s2s.user.create test handoff),
 *     this step must attempt delete and must report ok:true.
 *   - If no created userId exists, PASS and no-op (cannot delete nothing).
 *
 * Anti-false-positive rule:
 * - If userId exists, this test FAILS if delete was not attempted or not ok.
 */

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

const SHARED_SLOT_KEY = "auth.signup.createdUserId";

function getSharedStore(): Record<string, any> {
  const g = globalThis as any;
  if (!g.__nv_handler_test_shared) g.__nv_handler_test_shared = {};
  return g.__nv_handler_test_shared as Record<string, any>;
}

function readCreatedUserId(): string | undefined {
  const store = getSharedStore();
  const v = store[SHARED_SLOT_KEY];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function readHttpStatus(ctx: any): number {
  const v = ctx.get("response.status") ?? ctx.get("status") ?? 200;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 200;
}

function readHandlerStatus(ctx: any): string {
  const v = ctx.get("handlerStatus");
  return typeof v === "string" ? v : "ok";
}

export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: s2s.user.delete.onFailure test-mode cleanup — must delete created user when present",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-user-delete-onfailure-test-cleanup";

        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: s2s.user.delete.onFailure test-mode cleanup — must delete created user when present",
          expected: "success",
        });

        let ctx: any | undefined;

        try {
          ctx = deps.makeScenarioCtx({
            requestId,
            dtoType: "user",
            op: "s2s.user.delete.onFailure",
          });

          ctx.set("requestId", requestId);
          ctx.set("runMode", "test");

          const userId = readCreatedUserId();
          if (!userId) {
            // PASS: nothing to cleanup (no created user from earlier steps).
            return status;
          }

          // Minimal contract: the handler must be able to delete using signup.userId.
          ctx.set("signup.userId", userId);

          try {
            await deps.step.execute(ctx);

            const hs = readHandlerStatus(ctx);
            if (hs !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${hs}".`
              );
            }

            const httpStatus = readHttpStatus(ctx);
            if (httpStatus !== 200) {
              status.recordAssertionFailure(
                `Expected httpStatus=200 but got httpStatus=${httpStatus}.`
              );
            }

            const attempted = ctx.get("signup.userDeleteAttempted");
            if (attempted !== true) {
              status.recordAssertionFailure(
                "Expected signup.userDeleteAttempted === true when a created userId is present."
              );
            }

            const del = ctx.get("signup.userDeleteStatus");
            const ok =
              del && typeof del === "object" ? (del as any).ok : undefined;
            if (ok !== true) {
              status.recordAssertionFailure(
                "Expected signup.userDeleteStatus.ok === true when a created userId is present."
              );
            }
          } catch (err: any) {
            status.recordInnerCatch(err);
          }
        } catch (err: any) {
          status.recordOuterCatch(err);
        } finally {
          TestScenarioFinalizer.finalize({ status, ctx });
        }

        return status;
      },
    },
  ];
}
