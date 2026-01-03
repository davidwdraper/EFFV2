// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/toBag.user.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0040 (DTO-Only Persistence; edge → DTO)
 * - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 * - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 * - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Provide TWO handler-test scenarios for ToBagUserHandler:
 *   • Happy path: hydrate a singleton UserDto bag from a valid wire payload and
 *     apply ctx["signup.userId"] via setIdOnce().
 *   • Sad path: missing ctx["signup.userId"] yields a precondition failure.
 *
 * Critical invariant (new world):
 * - Tests must NOT construct controllers or runtimes.
 * - Scenario ctx MUST inherit pipeline runtime ("rt") from StepIterator.
 * - Handler execution MUST be production-shaped via deps.step.execute(ctx).
 *
 * ADR-0094 contract:
 * - No expectErrors anywhere.
 * - Scenario.run returns TestScenarioStatus.
 * - Inner try/catch wraps ONLY handler execution.
 * - Outer try/catch protects runner integrity.
 * - Finalization is deterministic via TestScenarioFinalizer.
 */

import type { BagItemWire } from "@nv/shared/registry/RegistryBase";
import { UserDtoRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

const TEST_USER_ID_V4 = "550e8400-e29b-41d4-a716-446655440000";

// ─────────────────────────────────────────────────────────────────────
// Scenario runner helper (shared per-file, not per-scenario)
// ─────────────────────────────────────────────────────────────────────

async function runScenario(input: {
  deps: any; // ScenarioDeps (kept as any to avoid import drift)
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
        op: "toBag.user",
      });

      input.seedCtx(ctx);

      await input.deps.step.execute(ctx);

      if (typeof input.expectedHttpStatus === "number") {
        const httpStatus =
          (ctx.get?.("response.status") as number | undefined) ??
          (ctx.get?.("status") as number | undefined) ??
          200;

        if (httpStatus !== input.expectedHttpStatus) {
          status.recordAssertionFailure(
            `Expected httpStatus=${input.expectedHttpStatus} but got httpStatus=${httpStatus}.`
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

// ─────────────────────────────────────────────────────────────────────
// ScenarioRunner entrypoint: getScenarios(deps)
// ─────────────────────────────────────────────────────────────────────

export async function getScenarios(deps: {
  step: { handlerName: string; execute: (scenarioCtx: any) => Promise<void> };
  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
}) {
  return [
    {
      id: "auth.signup.toBag.user.happy",
      name: "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        return runScenario({
          deps,
          testId: "auth.signup.toBag.user.happy",
          name: "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId",
          expectedMode: "success",
          expectedHttpStatus: 200,

          seedCtx: (ctx) => {
            // Old tests used HandlerTestBase.makeCtx({ body: ... }).
            // New world: seed directly onto scenario ctx.
            ctx.set("body", {
              items: [makeUserWireItem("0000001")],
            });

            // Sign-up MOS: id is minted earlier in the pipeline; we seed it explicitly here.
            ctx.set("signup.userId", TEST_USER_ID_V4);
          },

          assertAfter: (ctx, status) => {
            const handlerStatus = ctx.get("handlerStatus");
            if (String(handlerStatus ?? "") !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${String(
                  handlerStatus ?? ""
                )}".`
              );
            }

            const bag: any = ctx.get("bag");
            if (!bag) {
              status.recordAssertionFailure(
                "Expected ctx['bag'] to be defined."
              );
              return;
            }

            // Prefer items() iterator if present, otherwise fall back to backing array.
            const iterable: Iterable<any> =
              bag && typeof bag.items === "function"
                ? (bag.items() as Iterable<any>)
                : ((bag?._items ?? []) as Iterable<any>);

            const items: any[] = Array.from(iterable);
            if (items.length !== 1) {
              status.recordAssertionFailure(
                `Expected DtoBag to contain 1 item, got ${items.length}.`
              );
              return;
            }

            const userDto: any = items[0];
            const dtoId =
              userDto && typeof userDto.getId === "function"
                ? userDto.getId()
                : undefined;

            if (String(dtoId ?? "") !== TEST_USER_ID_V4) {
              status.recordAssertionFailure(
                `Expected UserDto id="${TEST_USER_ID_V4}" but got "${String(
                  dtoId ?? ""
                )}".`
              );
            }
          },
        });
      },
    },

    {
      id: "auth.signup.toBag.user.missingSignupUserId",
      name: "auth.signup: ToBagUserHandler fails when signup.userId is missing",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        return runScenario({
          deps,
          testId: "auth.signup.toBag.user.missingSignupUserId",
          name: "auth.signup: ToBagUserHandler fails when signup.userId is missing",
          expectedMode: "failure",
          // This is a precondition failure; lock it to 400 (change intentionally if you standardize otherwise).
          expectedHttpStatus: 400,

          seedCtx: (ctx) => {
            ctx.set("body", {
              items: [makeUserWireItem("0000002")],
            });

            // Intentionally DO NOT set ctx['signup.userId'] here.
          },

          assertAfter: (ctx, status) => {
            const handlerStatus = ctx.get("handlerStatus");
            if (String(handlerStatus ?? "") !== "error") {
              status.recordAssertionFailure(
                `Expected handlerStatus="error" but got "${String(
                  handlerStatus ?? ""
                )}".`
              );
            }

            // On error paths, bag should not be present (or at least not usable).
            // We don't hard-require absence because rails may choose to attach diagnostic state later.
          },
        });
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Shared helper: build User wire item via shared UserDtoRegistry
// ─────────────────────────────────────────────────────────────────────

function makeUserWireItem(suffix: string): BagItemWire {
  const registry = new UserDtoRegistry();
  const dto: any = registry.newUserDto();

  // Required name + email fields (no digits in names)
  dto.setGivenName?.("Signup");
  dto.setLastName?.("User");
  dto.setEmail?.(`signup.user+${suffix}@example.com`);

  // Optional contact / location fields carry uniqueness/variation
  dto.setPhone?.(`+1555${suffix.padStart(7, "0")}`);
  dto.setHomeLat?.(37.7749);
  dto.setHomeLng?.(-122.4194);

  // Optional address fields (all optional)
  dto.setAddress1?.("123 Test St");
  dto.setCity?.("Testville");
  dto.setState?.("CA");
  dto.setPcode?.("94101");

  const userJson = dto.toBody() as Record<string, unknown>;

  return {
    type: "user",
    ...userJson,
  } as BagItemWire;
}
