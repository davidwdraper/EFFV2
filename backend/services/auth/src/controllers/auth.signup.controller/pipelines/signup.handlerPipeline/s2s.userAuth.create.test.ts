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
 *
 * Purpose:
 * - Define handler-level tests for S2sUserAuthCreateHandler.
 *
 * IMPORTANT:
 * - Runner-shaped module: scenarios execute via deps.step.execute(ctx)
 *   so the scenario ctx inherits pipeline runtime ("rt") automatically.
 *
 * Note:
 * - UserDto.givenName / lastName validation forbids digits.
 *   Keep names strictly alphabetic; use email for uniqueness.
 *
 * Change (ADR-0092 alignment):
 * - Use registry-minted test DTOs (sidecar JSON hydrated) instead of ad-hoc DTO construction.
 * - Use deterministic isoTime strings (no Date.now / new Date()) to keep fixtures stable.
 */

import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";
import type { UserAuthDto } from "@nv/shared/dto/user-auth.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import { UserDtoRegistry as UserDtoRegistryCtor } from "@nv/shared/dto/registry/user.dtoRegistry";
import { UserAuthDtoRegistry as UserAuthDtoRegistryCtor } from "@nv/shared/dto/registry/user-auth.dtoRegistry";
import { newUuid } from "@nv/shared/utils/uuid";

type UserBag = DtoBag<UserDto>;

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

type Assert = { count: number; failed: string[] };

function assertEq(a: Assert, actual: any, expected: any, msg: string): void {
  a.count += 1;
  if (actual !== expected) {
    a.failed.push(`${msg} expected=${String(expected)} got=${String(actual)}`);
  }
}

function assertOk(a: Assert, cond: any, msg: string): void {
  a.count += 1;
  if (!cond) a.failed.push(msg);
}

// ───────────────────────────────────────────
// Rails helpers
// ───────────────────────────────────────────
function railsSnapshot(ctx: any): {
  handlerStatus: any;
  status: any;
  responseStatus: any;
} {
  const handlerStatus = ctx?.get?.("handlerStatus") ?? "ok";
  const status = ctx?.get?.("status") ?? 200;
  const responseStatus = ctx?.get?.("response.status");
  return { handlerStatus, status, responseStatus };
}

function isRailsError(s: {
  handlerStatus: any;
  status: any;
  responseStatus: any;
}): boolean {
  return (
    s.handlerStatus === "error" ||
    (typeof s.status === "number" && s.status >= 500) ||
    (typeof s.responseStatus === "number" && s.responseStatus >= 500)
  );
}

type HandlerTestResult = {
  testId: string;
  name: string;
  outcome: "passed" | "failed";
  expectedError: boolean;
  assertionCount: number;
  failedAssertions: string[];
  errorMessage?: string;
  durationMs: number;
  railsVerdict: "ok" | "rails_error" | "test_bug";
  railsStatus?: number;
  railsHandlerStatus?: string;
  railsResponseStatus?: number;
};

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
 * - We do NOT override its fields in the happy-path; the whole point is to use
 *   sidecar-hydrated values to prevent drift.
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

// ───────────────────────────────────────────
// Scenario runner helper
// ───────────────────────────────────────────
async function runScenario(input: {
  deps: any; // ScenarioDeps does not exist in this repo; keep loose.
  testId: string;
  name: string;
  expectedError: boolean;
  seed: {
    requestId: string;
    dtoType: string;
    op: string;

    signupUserId: string;

    // pipeline edge bag
    bag: any;

    // minted auth dto values (used to seed ctx keys)
    authDto: UserAuthDto;

    // whether to intentionally omit required keys
    omitAuthKeys?: boolean;
  };
  expectOkStatus: boolean;
}): Promise<HandlerTestResult> {
  const startedAt = Date.now();
  const a: Assert = { count: 0, failed: [] };

  try {
    const ctx = input.deps.makeScenarioCtx({
      requestId: input.seed.requestId,
      dtoType: input.seed.dtoType,
      op: input.seed.op,
    });

    // Required handler inputs
    ctx.set("signup.userId", input.seed.signupUserId);

    if (!input.seed.omitAuthKeys) {
      // Guardrails: if the minted DTO is empty or invalid, fail the test (drift detector).
      const hash = (input.seed.authDto as any).hash;
      const hashAlgo = (input.seed.authDto as any).hashAlgo;
      const hashParamsJson = (input.seed.authDto as any).hashParamsJson;
      const passwordCreatedAt = (input.seed.authDto as any).passwordCreatedAt;

      assertOk(
        a,
        typeof hash === "string" && hash.trim().length > 0,
        "minted UserAuthDto.hash must be non-empty"
      );
      assertOk(
        a,
        typeof hashAlgo === "string" && hashAlgo.trim().length > 0,
        "minted UserAuthDto.hashAlgo must be non-empty"
      );
      if (hashParamsJson !== undefined) {
        assertOk(
          a,
          typeof hashParamsJson === "string",
          "minted UserAuthDto.hashParamsJson must be a string when present"
        );
        try {
          JSON.parse(hashParamsJson);
        } catch {
          a.failed.push(
            "minted UserAuthDto.hashParamsJson must be valid JSON when present"
          );
        }
      }
      assertOk(
        a,
        typeof passwordCreatedAt === "string" &&
          passwordCreatedAt.trim().length > 0,
        "minted UserAuthDto.passwordCreatedAt must be non-empty"
      );

      // Seed from minted DTO so values satisfy DTO validation (no drift, no placeholders).
      ctx.set("signup.hash", hash);
      ctx.set("signup.hashAlgo", hashAlgo);
      ctx.set("signup.hashParamsJson", hashParamsJson);
      ctx.set("signup.passwordCreatedAt", passwordCreatedAt);
    } else {
      // Force the handler's hard-fail path: missing required ctx keys.
      ctx.set("signup.hash", "");
      ctx.set("signup.hashAlgo", "");
      ctx.set("signup.hashParamsJson", "");
      ctx.set("signup.passwordCreatedAt", "");
    }

    // Pipeline invariant: the edge response bag remains the UserDto bag.
    ctx.set("bag", input.seed.bag);

    // Execute handler in production shape (runner step).
    await input.deps.step.execute(ctx);

    const snap = railsSnapshot(ctx);
    const railsError = isRailsError(snap);

    assertEq(
      a,
      railsError,
      input.expectedError,
      input.expectedError
        ? "expected rails error but handler succeeded"
        : "unexpected rails error"
    );

    const expectedHandlerStatus = input.expectedError ? "error" : "ok";
    assertEq(
      a,
      String(snap.handlerStatus ?? ""),
      expectedHandlerStatus,
      `handlerStatus should be "${expectedHandlerStatus}"`
    );

    const status = ctx.get("signup.userAuthCreateStatus") as
      | UserAuthCreateStatus
      | undefined;

    if (input.expectOkStatus) {
      assertOk(
        a,
        !!status && status.ok === true,
        "signup.userAuthCreateStatus.ok should be true on happy path"
      );
    } else {
      assertOk(
        a,
        !!status && status.ok === false,
        "signup.userAuthCreateStatus.ok should be false on error paths"
      );
      if (status && status.ok === false) {
        assertOk(
          a,
          typeof status.code === "string" && status.code.length > 0,
          "signup.userAuthCreateStatus.code should be populated on error paths"
        );
        assertOk(
          a,
          typeof status.message === "string" && status.message.length > 0,
          "signup.userAuthCreateStatus.message should be populated on error paths"
        );
      }
    }

    const finishedAt = Date.now();
    return {
      testId: input.testId,
      name: input.name,
      outcome: a.failed.length === 0 ? "passed" : "failed",
      expectedError: input.expectedError,
      assertionCount: a.count,
      failedAssertions: a.failed,
      errorMessage: a.failed[0],
      durationMs: Math.max(0, finishedAt - startedAt),
      railsVerdict: a.failed.length === 0 ? "ok" : "rails_error",
      railsStatus: snap.status,
      railsHandlerStatus: snap.handlerStatus,
      railsResponseStatus: snap.responseStatus,
    };
  } catch (err) {
    const finishedAt = Date.now();
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    return {
      testId: input.testId,
      name: input.name,
      outcome: "failed",
      expectedError: input.expectedError,
      assertionCount: a.count,
      failedAssertions: a.failed.length ? a.failed : [msg],
      errorMessage: msg,
      durationMs: Math.max(0, finishedAt - startedAt),
      railsVerdict: "test_bug",
      railsStatus: undefined,
      railsHandlerStatus: undefined,
      railsResponseStatus: undefined,
    };
  }
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
      expectedError: false,
      async run(): Promise<HandlerTestResult> {
        const requestId = "req-auth-s2s-userauth-create-happy";
        const signupUserId = newUuid();

        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth S S");
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
          expectedError: false,
          seed: {
            requestId,
            dtoType: "user",
            op: "s2s.userAuth.create",
            signupUserId,
            bag,
            authDto,
          },
          expectOkStatus: true,
        });
      },
    },
    {
      id: "auth.signup.s2s.userAuth.create.missingFields",
      name: "auth.signup: S2sUserAuthCreateHandler rails when required signup auth fields are missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run(): Promise<HandlerTestResult> {
        const requestId = "req-auth-s2s-userauth-create-missing-fields";
        const signupUserId = newUuid();

        const bag = buildUserBag(signupUserId, requestId, (dto) => {
          dto.setGivenName?.("Auth S S");
          dto.setLastName?.("MissingAuthFields");
          dto.setEmail?.(
            `auth.s2s.userauth.create.missing+${signupUserId}@example.com`
          );
        });

        const authDto = mintUserAuthDto(signupUserId);

        return runScenario({
          deps,
          testId: "auth.signup.s2s.userAuth.create.missingFields",
          name: "auth.signup: S2sUserAuthCreateHandler sad path — missing auth fields",
          expectedError: true,
          seed: {
            requestId,
            dtoType: "user",
            op: "s2s.userAuth.create",
            signupUserId,
            bag,
            authDto,
            omitAuthKeys: true,
          },
          expectOkStatus: false,
        });
      },
    },
  ];
}
