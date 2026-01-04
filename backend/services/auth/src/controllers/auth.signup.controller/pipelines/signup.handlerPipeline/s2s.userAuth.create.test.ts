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
 *   - calls user-auth.create using signup auth ctx keys
 *   - writes ctx["signup.userAuthCreateStatus"] with ok=true
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
 * - No expectErrors, no ALS semantics, no log downgrades.
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
import type { UserAuthDto } from "@nv/shared/dto/user-auth.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDtoRegistry as UserDtoRegistryCtor } from "@nv/shared/dto/registry/user.dtoRegistry";
import { UserAuthDtoRegistry as UserAuthDtoRegistryCtor } from "@nv/shared/dto/registry/user-auth.dtoRegistry";
import { newUuid } from "@nv/shared/utils/uuid";

import { createTestScenarioStatus } from "@nv/shared/testing/createTestScenarioStatus";
import type { TestScenarioStatus } from "@nv/shared/testing/TestScenarioStatus";
import { TestScenarioFinalizer } from "@nv/shared/testing/TestScenarioFinalizer";

type UserBag = DtoBag<UserDto>;

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

// ───────────────────────────────────────────
// DTO/bag helpers
// ───────────────────────────────────────────

/**
 * Pipeline invariant:
 * - Edge response bag stays UserDto bag; handler never overwrites ctx["bag"].
 */
function buildUserBag(
  signupUserId: string,
  requestId: string,
  mutate?: (dto: UserDto) => void
): UserBag {
  const registry = new UserDtoRegistryCtor();

  // ✅ Registry-minted happy DTO (sidecar JSON hydrated + validated + collection seeded)
  const dto = registry.getTestDto("happy") as unknown as UserDto;

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

/**
 * Mint a UserAuthDto for test-data seeding.
 * - Use sidecar-hydrated values to avoid drift.
 */
function mintUserAuthDto(
  signupUserId: string,
  mutate?: (dto: UserAuthDto) => void
): UserAuthDto {
  const registry = new UserAuthDtoRegistryCtor();

  // ✅ Registry-minted happy DTO (sidecar JSON hydrated + validated + collection seeded)
  const dto = registry.getTestDto("happy") as unknown as UserAuthDto;

  // Most auth records are 1:1 with userId; keep it aligned.
  (dto as any).setUserId?.(signupUserId);

  if (mutate) mutate(dto);
  return dto;
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

function extractAuthSeed(authDto: UserAuthDto): {
  hash?: string;
  hashAlgo?: string;
  hashParamsJson?: string;
  passwordCreatedAt?: string;
} {
  const body: any =
    authDto && typeof (authDto as any).toBody === "function"
      ? (authDto as any).toBody()
      : {};

  return {
    hash: body?.hash,
    hashAlgo: body?.hashAlgo,
    hashParamsJson: body?.hashParamsJson,
    passwordCreatedAt: body?.passwordCreatedAt,
  };
}

// ───────────────────────────────────────────
// ScenarioRunner entrypoint
// ───────────────────────────────────────────

export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "HappyPath",
      name: "auth.signup: S2sUserAuthCreateHandler happy path — user-auth.create succeeds",
      shortCircuitOnFail: true,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-userauth-create-happy";
        const signupUserId = newUuid();

        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth");
          dto.setLastName?.("UserAuthCreate");
          dto.setEmail?.(
            `auth.s2s.userauth.create+${signupUserId}@example.com`
          );
        });

        // ✅ Mint auth test DTO and seed ctx from its sidecar-hydrated values.
        const authDto = mintUserAuthDto(signupUserId);
        const seed = extractAuthSeed(authDto);

        const status = createTestScenarioStatus({
          scenarioId: "HappyPath",
          scenarioName:
            "auth.signup: S2sUserAuthCreateHandler happy path — user-auth.create succeeds",
          expected: "success",
        });

        let ctx: any | undefined;

        // Outer try/catch protects runner integrity (ADR-0094).
        try {
          ctx = deps.makeScenarioCtx({
            requestId,
            dtoType: "user",
            op: "s2s.userAuth.create",
          });

          ctx.set("requestId", requestId);

          // Required handler inputs
          ctx.set("signup.userId", signupUserId);
          ctx.set("bag", bag);

          // Seed signup auth fields (no Date.now, no drift-y fixtures).
          if (seed.hash !== undefined) ctx.set("signup.hash", seed.hash);
          if (seed.hashAlgo !== undefined)
            ctx.set("signup.hashAlgo", seed.hashAlgo);
          if (seed.hashParamsJson !== undefined)
            ctx.set("signup.hashParamsJson", seed.hashParamsJson);
          if (seed.passwordCreatedAt !== undefined)
            ctx.set("signup.passwordCreatedAt", seed.passwordCreatedAt);

          // Inner try/catch wraps ONLY handler execution (ADR-0094).
          try {
            await deps.step.execute(ctx);

            // Assertions MUST NOT throw (ADR-0094).
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
