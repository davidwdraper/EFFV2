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
 * - ADR-0095 (Happy-Path-Only testing)
 *
 * Purpose:
 * - Happy-path smoke test for S2sUserCreateHandler:
 *   - calls user.create using ctx["bag"] (singleton UserDto)
 *   - requires password-hash outputs from step 3 to exist on ctx
 *   - writes ctx["signup.userCreateStatus"] with ok=true + userId
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
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

function buildUserBag(
  signupUserId: string,
  requestId: string,
  mutate?: (dto: UserDto) => void
): UserBag {
  const registry = new UserDtoRegistryCtor();
  const dto = registry.getTestDto("happy") as unknown as UserDto;

  if (mutate) mutate(dto);

  dto.setIdOnce?.(signupUserId);

  const { bag } = BagBuilder.fromDtos([dto], {
    requestId,
    limit: 1,
    total: 1,
    cursor: null,
  });

  return bag as UserBag;
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

export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: S2sUserCreateHandler happy path — user.create succeeds",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-user-create-happy";
        const signupUserId = newUuid();

        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          // Keep names strictly alphabetic; uniqueness goes in email.
          dto.setGivenName?.("Auth");
          dto.setLastName?.("UserCreate");
          dto.setEmail?.(`auth.s2s.user.create+${signupUserId}@example.com`);
        });

        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: S2sUserCreateHandler happy path — user.create succeeds",
          expected: "success",
        });

        let ctx: any | undefined;

        try {
          ctx = deps.makeScenarioCtx({
            requestId,
            dtoType: "user",
            op: "s2s.user.create",
          });

          ctx.set("requestId", requestId);
          ctx.set("signup.userId", signupUserId);
          ctx.set("bag", bag);

          // Seed: step 3 outputs (CodePasswordHashHandler).
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

            assertOkStatus(ctx, status, signupUserId);
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
