// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/toBag.user.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0095 (Happy-Path-Only testing)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0040 (DTO-Only Persistence; edge → DTO)
 * - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 * - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 * - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Happy-path smoke test for ToBagUserHandler:
 *   • hydrate a singleton UserDto bag from a valid wire payload and
 *     apply ctx["signup.userId"] via setIdOnce().
 *
 * Critical invariant (new world):
 * - Tests must NOT construct controllers or runtimes.
 * - Scenario ctx MUST inherit pipeline runtime ("rt") from StepIterator.
 * - Handler execution MUST be production-shaped via deps.step.execute(ctx).
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

import type { BagItemWire } from "@nv/shared/registry/RegistryBase";
import { UserDtoRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";

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

const TEST_USER_ID_V4 = "550e8400-e29b-41d4-a716-446655440000";

export async function getScenarios(deps: ScenarioDepsLike) {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId",
      shortCircuitOnFail: true,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId",
          expected: "success",
        });

        let ctx: any | undefined;

        // Outer try/catch protects runner integrity (ADR-0094).
        try {
          ctx = localDeps.makeScenarioCtx({
            requestId: "req-auth-signup-toBag-user",
            dtoType: "user",
            op: "toBag.user",
          });

          // Seed scenario ctx (new world: no HandlerTestBase).
          ctx.set("body", { items: [makeUserWireItem("0000001")] });

          // Signup MOS: userId is minted earlier; seed explicitly.
          ctx.set("signup.userId", TEST_USER_ID_V4);

          // Inner try/catch wraps ONLY handler execution (ADR-0094).
          try {
            await localDeps.step.execute(ctx);

            // Assertions MUST NOT throw (ADR-0094).
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
              return status;
            }

            const iterable: Iterable<any> =
              bag && typeof bag.items === "function"
                ? (bag.items() as Iterable<any>)
                : ((bag?._items ?? []) as Iterable<any>);

            const items: any[] = Array.from(iterable);
            if (items.length !== 1) {
              status.recordAssertionFailure(
                `Expected DtoBag to contain 1 item, got ${items.length}.`
              );
              return status;
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
