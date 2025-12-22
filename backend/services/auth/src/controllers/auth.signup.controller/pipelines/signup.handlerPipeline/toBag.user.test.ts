// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/toBag.user.test.ts

/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
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
 * ScenarioRunner contract:
 * - This module is discovered via HandlerTestModuleLoader using:
 *     indexRelativePath + handlerName = "toBag.user"
 * - It MUST:
 *   • export ToBagUserTest (canonical test class)
 *   • export getScenarios(), which returns an array of scenario definitions.
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { BagItemWire } from "@nv/shared/registry/RegistryBase";

import { UserDtoRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";
import { ToBagUserHandler } from "./toBag.user";

const TEST_USER_ID_V4 = "550e8400-e29b-41d4-a716-446655440000";

/**
 * Canonical happy-path test:
 * - Used by handler.runTest() via ToBagUserTest.
 */
export class ToBagUserTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.toBag.user.happy";
  }

  public testName(): string {
    return "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId";
  }

  protected expectedError(): boolean {
    // Happy-path smoke: handlerStatus !== "error".
    return false;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-toBagUser-happy",
      dtoType: "user",
      op: "toBag.user",
      body: {
        items: [makeUserWireItem("0000001")],
      },
    });

    // Sign-up MOS: id is minted earlier in the pipeline; we seed it explicitly here.
    ctx.set("signup.userId", TEST_USER_ID_V4);

    await this.runHandler({
      handlerCtor: ToBagUserHandler,
      ctx,
    });

    // Handler rail only; HTTP status is interpreted by rails, not by this test.
    const handlerStatus = ctx.get<string>("handlerStatus");
    this.assertEq(
      String(handlerStatus ?? ""),
      "ok",
      "handlerStatus should be 'ok' on happy path"
    );

    const bag: any = ctx.get("bag");
    this.assertEq(String(bag != null), "true", "ctx['bag'] should be defined");

    // Prefer items() iterator if present, otherwise fall back to backing array.
    const iterable: Iterable<any> =
      bag && typeof bag.items === "function"
        ? (bag.items() as Iterable<any>)
        : ((bag?._items ?? []) as Iterable<any>);

    const items: any[] = Array.from(iterable);
    this.assertEq(
      String(items.length),
      "1",
      "DtoBag should contain exactly one UserDto"
    );

    const userDto: any = items[0];
    const dtoId =
      userDto && typeof userDto.getId === "function"
        ? userDto.getId()
        : undefined;

    this.assertEq(
      String(dtoId ?? ""),
      TEST_USER_ID_V4,
      "UserDto id should match ctx['signup.userId']"
    );
  }
}

/**
 * Sad-path scenario: missing signup.userId
 * - Valid wire bag
 * - NO signup.userId set on ctx
 * - Expects:
 *   • handlerStatus = "error"
 *   • Rails will interpret HTTP status; test does not assert numeric code.
 */
export class ToBagUserMissingUserIdTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.toBag.user.missingSignupUserId";
  }

  public testName(): string {
    return "auth.signup: ToBagUserHandler fails when signup.userId is missing";
  }

  protected expectedError(): boolean {
    // This scenario is explicitly an expected failure.
    return true;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-toBagUser-missingUserId",
      dtoType: "user",
      op: "toBag.user",
      body: {
        items: [makeUserWireItem("0000002")],
      },
    });

    // Intentionally DO NOT set ctx['signup.userId'] here.

    await this.runHandler({
      handlerCtor: ToBagUserHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when signup.userId is missing"
    );

    // Numeric HTTP status is interpreted once in the rails and recorded on
    // HandlerTestDto (railsStatus). We do not assert it here at handler scope.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Shared helper: build User wire item via shared UserDtoRegistry
// ─────────────────────────────────────────────────────────────────────

/**
 * Builds a canonical User wire item for auth.signup tests:
 * - DTO is instantiated via the shared UserDtoRegistry (never via `new UserDto`).
 * - Fields are populated via DTO setters where available.
 * - JSON is produced via dto.toBody() and wrapped into a BagItemWire.
 *
 * Required per UserDto contract:
 * - givenName (letters/spaces only via normalizeRequiredName)
 * - lastName  (letters/spaces only via normalizeRequiredName)
 * - email     (validated via assertValidEmail)
 *
 * NOTE: Suffix for uniqueness is carried in email/phone, not in name fields,
 * because normalizeRequiredName rejects digits and other characters.
 */
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

// ─────────────────────────────────────────────────────────────────────
// ScenarioRunner entrypoint: getScenarios()
// ─────────────────────────────────────────────────────────────────────

/**
 * ScenarioRunner entrypoint:
 * - Two scenarios for this handler:
 *   • Happy path (no expected rail error).
 *   • Sad path (handler is expected to fail and test asserts that).
 *
 * Shape aligns with Build-a-test-guide:
 *   • id
 *   • name
 *   • shortCircuitOnFail
 *   • expectedError
 *   • async run() → returns HandlerTestResult from HandlerTestBase.run()
 */
export async function getScenarios() {
  return [
    {
      id: "auth.signup.toBag.user.happy",
      name: "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        const test = new ToBagUserTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.toBag.user.missingSignupUserId",
      name: "auth.signup: ToBagUserHandler fails when signup.userId is missing",
      shortCircuitOnFail: true,
      expectedError: true,
      async run() {
        const test = new ToBagUserMissingUserIdTest();
        return await test.run();
      },
    },
  ];
}
