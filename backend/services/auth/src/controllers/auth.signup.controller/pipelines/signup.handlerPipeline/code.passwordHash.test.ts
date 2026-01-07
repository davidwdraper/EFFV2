// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.passwordHash.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0040 (DTO-Only Persistence; edge → DTO)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0095 (Happy-Path-Only testing)
 *
 * Purpose:
 * - Happy-path smoke test for CodePasswordHashHandler:
 *   - reads password from HTTP header
 *   - derives signup.passwordHash + signup.passwordAlgo (+ params + createdAt)
 *   - remains on the "ok" rail (HTTP 200)
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

import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";
import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";

/**
 * Minimal local contract:
 * - DO NOT import test-runner source across services.
 * - Structural typing is enough for the runner to call getScenarios(deps) and scenario.run(deps).
 */
type ScenarioDepsLike = {
  step: { execute: (scenarioCtx: any) => Promise<void> };
  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
};

function readHttpStatus(ctx: any): number {
  const v = ctx.get("response.status") ?? ctx.get("status") ?? 200;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 200;
}

export function getScenarios(deps: ScenarioDepsLike) {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: CodePasswordHashHandler reads password header, derives hash + algo",
      shortCircuitOnFail: true,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: CodePasswordHashHandler reads password header, derives hash + algo",
          expected: "success",
        });

        let ctx: any | undefined;

        // Outer try/catch protects runner integrity (ADR-0094).
        try {
          ctx = localDeps.makeScenarioCtx({
            requestId: "req-auth-passwordHash-happy",
            dtoType: "user",
            op: "code.passwordHash",
          });

          // Seed inbound headers for the controller/runtime.
          // Contract: handler reads x-nv-password from controller (preferred).
          // Test runner environments may expose headers via ctx (compat).
          ctx.set("http.headers", {
            "x-nv-password": "StrongPassw0rd#",
          });

          // Inner try/catch wraps ONLY handler execution (ADR-0094).
          try {
            await localDeps.step.execute(ctx);

            // Assertions MUST NOT throw (ADR-0094).
            const handlerStatus = String(ctx.get("handlerStatus") ?? "ok");
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

            const hash = ctx.get("signup.passwordHash");
            if (typeof hash !== "string" || hash.length < 16) {
              status.recordAssertionFailure(
                "Expected signup.passwordHash to be a non-empty string."
              );
            }

            const algo = ctx.get("signup.passwordAlgo");
            if (typeof algo !== "string" || !algo.trim()) {
              status.recordAssertionFailure(
                "Expected signup.passwordAlgo to be a non-empty string."
              );
            }

            const paramsJson = ctx.get("signup.passwordHashParamsJson");
            if (typeof paramsJson !== "string" || !paramsJson.trim()) {
              status.recordAssertionFailure(
                "Expected signup.passwordHashParamsJson to be a non-empty string."
              );
            }

            const createdAt = ctx.get("signup.passwordCreatedAt");
            if (typeof createdAt !== "string" || !createdAt.trim()) {
              status.recordAssertionFailure(
                "Expected signup.passwordCreatedAt to be a non-empty string."
              );
            }

            // Never stash cleartext.
            const clear = ctx.get("signup.passwordClear");
            if (typeof clear !== "undefined") {
              status.recordAssertionFailure(
                "Expected signup.passwordClear to remain absent (undefined)."
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

        // Critical: unconditional return so TS never complains.
        return status;
      },
    },
  ];
}
