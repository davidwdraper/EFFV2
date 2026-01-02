// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.passwordHash.test.ts
/**
 * Docs:
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0040 (DTO-Only Persistence; edge → DTO)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose (THIS SESSION — TRIPWIRES ONLY):
 * - Prove whether ScenarioRunner is:
 *   (1) calling getScenarios(deps),
 *   (2) calling scenario.run(deps),
 *   (3) reaching deps.step.execute(ctx).
 *
 * IMPORTANT:
 * - Do not “fix” anything in here beyond the tripwires + making the module
 *   match the runner contract (getScenarios(deps) + scenario.run(deps)).
 *
 * Rails note:
 * - The ONLY ctx flag for expected-negative downgrade is `expectErrors` (plural).
 * - `expectedError` is scenario/result metadata — DO NOT set it on ctx.
 */

import * as crypto from "crypto";

import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

console.log("!!!!!!!!!!!!LOADED code.passwordHash.test.js", __filename);

/**
 * Minimal local contract:
 * - DO NOT import test-runner source across services.
 * - Structural typing is enough for the runner to call getScenarios(deps) and scenario.run(deps).
 */
type ScenarioDeps = {
  step: {
    handlerName: string;
    execute: (scenarioCtx: any) => Promise<void>;
  };

  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
};

type HandlerTestScenarioDef = {
  id: string;
  name: string;
  expectedError: boolean;
  shortCircuitOnFail?: boolean;
  run: (deps: ScenarioDeps) => Promise<HandlerTestResult>;
};

// Small helper: produce a HandlerTestResult without pulling in HandlerTestBase.
function makeResult(input: {
  testId: string;
  name: string;
  outcome: "passed" | "failed";
  expectedError: boolean;
  errorMessage?: string;
}): HandlerTestResult {
  return {
    testId: input.testId,
    name: input.name,
    outcome: input.outcome,
    expectedError: input.expectedError,
    assertionCount: 0,
    failedAssertions: input.errorMessage ? [input.errorMessage] : [],
    errorMessage: input.errorMessage,
    durationMs: 0,
    railsVerdict: undefined,
    railsStatus: undefined,
    railsHandlerStatus: undefined,
    railsResponseStatus: undefined,
  };
}

/**
 * ScenarioRunner entrypoint.
 */
export async function getScenarios(
  deps: ScenarioDeps
): Promise<HandlerTestScenarioDef[]> {
  // TRIPWIRE A
  console.log("!!!!!!!!!TRIPWIRE getScenarios CALLED", {
    hasDeps: !!deps,
    hasStep: !!deps?.step,
  });

  return [
    {
      id: "auth.signup.code.passwordHash.happy",
      name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
      shortCircuitOnFail: true,
      expectedError: false,

      async run(runDeps: ScenarioDeps): Promise<HandlerTestResult> {
        // TRIPWIRE B
        console.log(
          "!!!!!!!!!TRIPWIRE run ENTER",
          "auth.signup.code.passwordHash.happy"
        );

        try {
          const ctx = runDeps.makeScenarioCtx({
            requestId: "req-auth-passwordHash-happy",
            dtoType: "user",
            op: "code.passwordHash",
          });

          ctx.set("signup.passwordClear", "StrongPassw0rd#");

          // TRIPWIRE C
          console.log("!!!!!!!!!TRIPWIRE before execute", {
            handlerName: runDeps.step.handlerName,
            requestId: ctx.get("requestId"),
            expectErrors: ctx.get("test.expectErrors"),
          });

          await runDeps.step.execute(ctx);

          console.log("!!!!!!!!!TRIPWIRE after execute", {
            handlerName: runDeps.step.handlerName,
            requestId: ctx.get("requestId"),
            expectErrors: ctx.get("test.expectErrors"),
            handlerStatus: ctx.get("handlerStatus"),
            status: ctx.get("status"),
            responseStatus: ctx.get("response.status"),
          });

          const handlerStatus = ctx.get("handlerStatus") ?? "ok";
          const status = ctx.get("response.status") ?? ctx.get("status") ?? 200;

          if (handlerStatus !== "ok" || status >= 500) {
            return makeResult({
              testId: "auth.signup.code.passwordHash.happy",
              name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
              outcome: "failed",
              expectedError: false,
              errorMessage: `Unexpected rails error. handlerStatus=${handlerStatus}, status=${status}`,
            });
          }

          return makeResult({
            testId: "auth.signup.code.passwordHash.happy",
            name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
            outcome: "passed",
            expectedError: false,
          });
        } catch (err: any) {
          const msg =
            err instanceof Error ? err.message : String(err ?? "unknown");
          return makeResult({
            testId: "auth.signup.code.passwordHash.happy",
            name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
            outcome: "failed",
            expectedError: false,
            errorMessage: msg,
          });
        }
      },
    },

    {
      id: "auth.signup.code.passwordHash.missingPassword",
      name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
      shortCircuitOnFail: false,
      expectedError: true,

      async run(runDeps: ScenarioDeps): Promise<HandlerTestResult> {
        // TRIPWIRE B
        console.log(
          "!!!!!!!!!TRIPWIRE run ENTER",
          "auth.signup.code.passwordHash.missingPassword"
        );

        try {
          const ctx = runDeps.makeScenarioCtx({
            requestId: "req-auth-passwordHash-missingPassword",
            dtoType: "user",
            op: "code.passwordHash",
          });

          // Intentionally do NOT seed ctx['signup.passwordClear'].

          // TRIPWIRE C
          console.log("!!!!!!!!!TRIPWIRE before execute", {
            handlerName: runDeps.step.handlerName,
            requestId: ctx.get("requestId"),
            expectErrors: ctx.get("test.expectErrors"),
          });

          await runDeps.step.execute(ctx);

          console.log("!!!!!!!!!TRIPWIRE after execute", {
            handlerName: runDeps.step.handlerName,
            requestId: ctx.get("requestId"),
            expectErrors: ctx.get("test.expectErrors"),
            handlerStatus: ctx.get("handlerStatus"),
            status: ctx.get("status"),
            responseStatus: ctx.get("response.status"),
          });

          const handlerStatus = ctx.get("handlerStatus") ?? "ok";
          const status = ctx.get("response.status") ?? ctx.get("status") ?? 200;

          if (handlerStatus !== "error" || status < 400) {
            return makeResult({
              testId: "auth.signup.code.passwordHash.missingPassword",
              name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
              outcome: "failed",
              expectedError: true,
              errorMessage: `Expected rails error but got handlerStatus=${handlerStatus}, status=${status}`,
            });
          }

          return makeResult({
            testId: "auth.signup.code.passwordHash.missingPassword",
            name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
            outcome: "passed",
            expectedError: true,
          });
        } catch (err: any) {
          const msg =
            err instanceof Error ? err.message : String(err ?? "unknown");
          return makeResult({
            testId: "auth.signup.code.passwordHash.missingPassword",
            name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
            outcome: "failed",
            expectedError: true,
            errorMessage: msg,
          });
        }
      },
    },

    {
      id: "auth.signup.code.passwordHash.hashFailure",
      name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
      shortCircuitOnFail: false,
      expectedError: true,

      async run(runDeps: ScenarioDeps): Promise<HandlerTestResult> {
        // TRIPWIRE B
        console.log(
          "!!!!!!!!!TRIPWIRE run ENTER",
          "auth.signup.code.passwordHash.hashFailure"
        );

        try {
          const ctx = runDeps.makeScenarioCtx({
            requestId: "req-auth-passwordHash-failure",
            dtoType: "user",
            op: "code.passwordHash",
          });

          ctx.set("signup.passwordClear", "AnotherStrongPass#1");

          ctx.set("signup.passwordHashFn", ((
            _password: string,
            _salt: string | Buffer,
            _keylen: number
          ): Buffer => {
            throw new Error("TEST_FORCED_SCRYPT_FAILURE");
          }) as typeof crypto.scryptSync);

          // TRIPWIRE C
          console.log("!!!!!!!!!TRIPWIRE before execute", {
            handlerName: runDeps.step.handlerName,
            requestId: ctx.get("requestId"),
            expectErrors: ctx.get("test.expectErrors"),
          });

          await runDeps.step.execute(ctx);

          console.log("!!!!!!!!!TRIPWIRE after execute", {
            handlerName: runDeps.step.handlerName,
            requestId: ctx.get("requestId"),
            expectErrors: ctx.get("test.expectErrors"),
            handlerStatus: ctx.get("handlerStatus"),
            status: ctx.get("status"),
            responseStatus: ctx.get("response.status"),
          });

          const handlerStatus = ctx.get("handlerStatus") ?? "ok";
          const status = ctx.get("response.status") ?? ctx.get("status") ?? 200;

          if (handlerStatus !== "error" || status < 400) {
            return makeResult({
              testId: "auth.signup.code.passwordHash.hashFailure",
              name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
              outcome: "failed",
              expectedError: true,
              errorMessage: `Expected rails error but got handlerStatus=${handlerStatus}, status=${status}`,
            });
          }

          return makeResult({
            testId: "auth.signup.code.passwordHash.hashFailure",
            name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
            outcome: "passed",
            expectedError: true,
          });
        } catch (err: any) {
          const msg =
            err instanceof Error ? err.message : String(err ?? "unknown");
          return makeResult({
            testId: "auth.signup.code.passwordHash.hashFailure",
            name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
            outcome: "failed",
            expectedError: true,
            errorMessage: msg,
          });
        }
      },
    },
  ];
}
