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
 *
 * Purpose:
 * - Define handler-level tests for S2sUserAuthCreateHandler (ADR-0094 shape).
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
 * - No expectErrors, no ALS semantics, no log downgrades.
 *
 * Change (ADR-0092 alignment, preserved):
 * - Use registry-minted test DTOs (sidecar JSON hydrated) instead of ad-hoc DTO construction.
 * - Do not use Date.now / new Date() for fixtures; rely on sidecar values for stability.
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

// ───────────────────────────────────────────
// ADR-0094 scenario runner helper
// ───────────────────────────────────────────

async function runScenario(input: {
  deps: any;
  testId: string;
  name: string;

  expectedMode: "success" | "failure";
  expectedHttpStatus?: number;

  seedCtx: (ctx: any, status: TestScenarioStatus) => void;
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
        op: "s2s.userAuth.create",
      });

      input.seedCtx(ctx, status);

      await input.deps.step.execute(ctx);

      if (typeof input.expectedHttpStatus === "number") {
        const httpStatus = readHttpStatus(ctx);
        if (httpStatus !== input.expectedHttpStatus) {
          status.recordAssertionFailure(
            `Expected httpStatus=${
              input.expectedHttpStatus
            } but got httpStatus=${httpStatus} (handlerStatus=${readHandlerStatus(
              ctx
            )}).`
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

// ───────────────────────────────────────────
// Assertions (record failures; do not throw)
// ───────────────────────────────────────────

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

function assertErrorStatus(ctx: any, status: TestScenarioStatus): void {
  const s = ctx.get("signup.userAuthCreateStatus") as
    | UserAuthCreateStatus
    | undefined;

  if (!s || s.ok !== false) {
    status.recordAssertionFailure(
      "signup.userAuthCreateStatus.ok should be false on error paths."
    );
    return;
  }

  if (typeof s.code !== "string" || s.code.length === 0) {
    status.recordAssertionFailure(
      "signup.userAuthCreateStatus.code should be populated on error paths."
    );
  }

  if (typeof s.message !== "string" || s.message.length === 0) {
    status.recordAssertionFailure(
      "signup.userAuthCreateStatus.message should be populated on error paths."
    );
  }
}

function extractAuthSeed(
  authDto: UserAuthDto,
  status: TestScenarioStatus
): {
  hash?: string;
  hashAlgo?: string;
  hashParamsJson?: string;
  passwordCreatedAt?: string;
} {
  // Prefer toBody() as the stable DTO surface for tests.
  const body: any =
    authDto && typeof (authDto as any).toBody === "function"
      ? (authDto as any).toBody()
      : {};

  const hash = body?.hash;
  const hashAlgo = body?.hashAlgo;
  const hashParamsJson = body?.hashParamsJson;
  const passwordCreatedAt = body?.passwordCreatedAt;

  if (typeof hash !== "string" || hash.trim().length === 0) {
    status.recordAssertionFailure("minted UserAuthDto.hash must be non-empty.");
  }
  if (typeof hashAlgo !== "string" || hashAlgo.trim().length === 0) {
    status.recordAssertionFailure(
      "minted UserAuthDto.hashAlgo must be non-empty."
    );
  }
  if (hashParamsJson !== undefined) {
    if (typeof hashParamsJson !== "string") {
      status.recordAssertionFailure(
        "minted UserAuthDto.hashParamsJson must be a string when present."
      );
    } else {
      try {
        JSON.parse(hashParamsJson);
      } catch {
        status.recordAssertionFailure(
          "minted UserAuthDto.hashParamsJson must be valid JSON when present."
        );
      }
    }
  }
  if (
    typeof passwordCreatedAt !== "string" ||
    passwordCreatedAt.trim().length === 0
  ) {
    status.recordAssertionFailure(
      "minted UserAuthDto.passwordCreatedAt must be non-empty."
    );
  }

  return { hash, hashAlgo, hashParamsJson, passwordCreatedAt };
}

// ───────────────────────────────────────────
// ScenarioRunner entrypoint
// ───────────────────────────────────────────

export async function getScenarios(deps: any): Promise<any[]> {
  return [
    {
      id: "auth.signup.s2s.userAuth.create.happy",
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

        // ✅ Mint auth test DTO and use its sidecar-hydrated values (no overrides).
        const authDto = mintUserAuthDto(signupUserId);

        return runScenario({
          deps,
          testId: "auth.signup.s2s.userAuth.create.happy",
          name: "auth.signup: S2sUserAuthCreateHandler happy path — user-auth.create succeeds",
          expectedMode: "success",
          expectedHttpStatus: 200,

          seedCtx: (ctx, status) => {
            ctx.set("requestId", requestId);

            // Required handler inputs
            ctx.set("signup.userId", signupUserId);
            ctx.set("bag", bag);

            // Seed ctx keys from minted DTO (drift detector + prod-shaped inputs).
            const seed = extractAuthSeed(authDto, status);
            if (seed.hash !== undefined) ctx.set("signup.hash", seed.hash);
            if (seed.hashAlgo !== undefined)
              ctx.set("signup.hashAlgo", seed.hashAlgo);
            if (seed.hashParamsJson !== undefined)
              ctx.set("signup.hashParamsJson", seed.hashParamsJson);
            if (seed.passwordCreatedAt !== undefined)
              ctx.set("signup.passwordCreatedAt", seed.passwordCreatedAt);
          },

          assertAfter: (ctx, status) => {
            const handlerStatus = readHandlerStatus(ctx);
            if (handlerStatus !== "ok") {
              status.recordAssertionFailure(
                `Expected handlerStatus="ok" but got "${handlerStatus}".`
              );
            }
            assertOkStatus(ctx, status);
          },
        });
      },
    },

    {
      id: "auth.signup.s2s.userAuth.create.missingFields",
      name: "auth.signup: S2sUserAuthCreateHandler rails when required signup auth fields are missing",
      shortCircuitOnFail: false,

      async run(): Promise<TestScenarioStatus> {
        const requestId = "req-auth-s2s-userauth-create-missing-fields";
        const signupUserId = newUuid();

        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth");
          dto.setLastName?.("MissingAuthFields");
          dto.setEmail?.(
            `auth.s2s.userauth.create.missing+${signupUserId}@example.com`
          );
        });

        // Still mint it so we can detect sidecar drift, but we will NOT seed ctx keys.
        const authDto = mintUserAuthDto(signupUserId);

        return runScenario({
          deps,
          testId: "auth.signup.s2s.userAuth.create.missingFields",
          name: "auth.signup: S2sUserAuthCreateHandler sad path — missing auth fields",
          expectedMode: "failure",
          expectedHttpStatus: 400,

          seedCtx: (ctx, status) => {
            ctx.set("requestId", requestId);

            ctx.set("signup.userId", signupUserId);
            ctx.set("bag", bag);

            // Drift detector only (do not seed required ctx keys).
            // If the minted DTO is broken, we still want to know *now*.
            extractAuthSeed(authDto, status);

            // Intentionally omit:
            // - signup.hash
            // - signup.hashAlgo
            // - signup.hashParamsJson
            // - signup.passwordCreatedAt
          },

          assertAfter: (ctx, status) => {
            const handlerStatus = readHandlerStatus(ctx);
            if (handlerStatus !== "error") {
              status.recordAssertionFailure(
                `Expected handlerStatus="error" but got "${handlerStatus}".`
              );
            }
            assertErrorStatus(ctx, status);
          },
        });
      },
    },
  ];
}
