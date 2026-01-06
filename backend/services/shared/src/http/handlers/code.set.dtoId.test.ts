// backend/services/shared/src/http/handlers/code.set.dtoId.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0094 (Test Scenario Error Handling and Logging)
 * - ADR-0095 (Happy-Path-Only testing)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0057 (ID Generation & Validation — UUIDv4; immutable)
 *
 * Purpose:
 * - Happy-path smoke test for CodeSetDtoIdHandler:
 *   - reads ctx["step.uuid"]
 *   - sets dto._id via setIdOnce() on the bagged DTO (ctx["bag"])
 *   - stays on the "ok" rail
 *
 * ADR-0095:
 * - Exactly one scenario: HappyPath
 */

import { createTestScenarioStatus } from "../../testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "../../testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "../../testing/TestScenarioFinalizer";

import { DtoBase } from "../../dto/DtoBase";
import { DtoBag } from "../../dto/DtoBag";

type ScenarioDepsLike = {
  step: { execute: (scenarioCtx: any) => Promise<void> };
  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
};

class FakeDto extends DtoBase {
  public constructor() {
    super(DtoBase.getSecret());
  }
  public override getType(): string {
    return "fake";
  }
  public override toBody(): unknown {
    return { _id: this.hasId() ? this.getId() : undefined };
  }
}

function isUuidV4(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

export async function getScenarios(deps: ScenarioDepsLike) {
  return [
    {
      id: "HappyPath",
      name: "code.set.dtoId: applies ctx['step.uuid'] onto bagged dto._id",
      shortCircuitOnFail: true,

      async run(localDeps: ScenarioDepsLike): Promise<TestScenarioStatus> {
        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "code.set.dtoId: applies ctx['step.uuid'] onto bagged dto._id",
          expected: "success",
        });

        let ctx: any | undefined;

        try {
          ctx = localDeps.makeScenarioCtx({
            requestId: "req-code-set-dtoId",
            dtoType: "auth.signup",
            op: "set.dtoId",
          });

          const dto = new FakeDto();
          const bag = new DtoBag([dto]);

          // Preconditions this handler requires (no seeder needed in this scenario).
          ctx.set("bag", bag);

          // Use a stable UUIDv4 string.
          const uuid = "7b7e9e2a-1d3a-4c0f-8d2d-7c9f4f4b1c2a";
          ctx.set("step.uuid", uuid);

          try {
            await localDeps.step.execute(ctx);

            const handlerStatus = ctx.get("handlerStatus");
            if (handlerStatus !== "ok") {
              status.recordAssertionFailure(
                `Expected ctx['handlerStatus']="ok" but got "${String(
                  handlerStatus
                )}".`
              );
            }

            const got = dto.hasId() ? dto.getId() : undefined;

            if (!isUuidV4(got)) {
              status.recordAssertionFailure(
                `Expected dto.getId() to be UUIDv4 but got "${String(got)}".`
              );
            }

            if (got !== uuid) {
              status.recordAssertionFailure(
                `Expected dto.getId()="${uuid}" but got "${String(got)}".`
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
