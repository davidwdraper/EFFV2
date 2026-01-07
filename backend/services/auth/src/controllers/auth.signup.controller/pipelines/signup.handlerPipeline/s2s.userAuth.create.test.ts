// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.userAuth.create.test.ts
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
 * - ADR-0095 (Happy-Path-Only testing)
 *
 * Purpose:
 * - Happy-path smoke test for S2sUserAuthCreateHandler:
 *   - uses signup auth ctx keys produced by CodePasswordHashHandler
 *   - calls user-auth.create via SvcClient
 *   - writes ctx["signup.userAuthCreateStatus"] with ok=true
 *
 * ADR-0095:
 * - Exactly one scenario: HappyPath
 *
 * ADR-0094 contract:
 * - No expectErrors anywhere.
 * - Scenario.run returns TestScenarioStatus.
 * - Inner try/catch wraps ONLY handler execution.
 * - Outer try/catch protects runner integrity.
 * - Finalization is deterministic via TestScenarioFinalizer (run exactly once).
 */

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

function readHttpStatus(ctx: any): number {
  const v = ctx.get("response.status") ?? ctx.get("status") ?? 200;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 200;
}

function readHandlerStatus(ctx: any): string {
  const v = ctx.get("handlerStatus");
  return typeof v === "string" ? v : "ok";
}

function assertOkStatus(ctx: any, status: TestScenarioStatus): void {
  const s = ctx.get("signup.userAuthCreateStatus") as
    | UserAuthCreateStatus
    | undefined;

  if (!s || s.ok !== true) {
    status.recordAssertionFailure(
      "signup.userAuthCreateStatus.ok should be true on happy path."
    );
  }
}

export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: S2sUserAuthCreateHandler happy path — user-auth.create succeeds",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-userauth-create-happy";
        const signupUserId = "00000000-0000-4000-8000-000000000001"; // stable for this unit-ish test

        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: S2sUserAuthCreateHandler happy path — user-auth.create succeeds",
          expected: "success",
        });

        let ctx: any | undefined;

        try {
          ctx = deps.makeScenarioCtx({
            requestId,
            dtoType: "user",
            op: "s2s.userAuth.create",
          });

          ctx.set("requestId", requestId);

          // Required handler inputs
          ctx.set("signup.userId", signupUserId);

          // Seed: step 3 outputs (CodePasswordHashHandler)
          ctx.set("signup.passwordHash", "deadbeefdeadbeefdeadbeefdeadbeef");
          ctx.set("signup.passwordAlgo", "scrypt");
          ctx.set(
            "signup.passwordHashParamsJson",
            JSON.stringify({ saltHex: "00", keyLen: 64, algo: "scrypt" })
          );
          ctx.set("signup.passwordCreatedAt", new Date().toISOString());

          try {
            await deps.step.execute(ctx);

            const handlerStatus = readHandlerStatus(ctx);
            if (handlerStatus !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${handlerStatus}".`
              );
            }

            const httpStatus = readHttpStatus(ctx);
            if (httpStatus !== 200) {
              status.recordAssertionFailure(
                `Expected httpStatus=200 but got httpStatus=${httpStatus}.`
              );
            }

            assertOkStatus(ctx, status);

            // Invariant: handler must not overwrite the edge bag
            const bag = ctx.get("bag");
            if (typeof bag !== "undefined") {
              // This handler should not be touching ctx["bag"] at all; keep it absent in this test.
              // If your runner always seeds bag, remove this assertion.
              status.recordAssertionFailure(
                'Expected ctx["bag"] to remain untouched/absent in this isolated handler test.'
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

        return status; // unconditional return (TS2355 guard)
      },
    },
  ];
}
