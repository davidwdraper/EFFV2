// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/toBag.user.test.ts

/**
 * Docs:
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
 * - Multi-scenario handler test for ToBagUserHandler:
 *   • Happy path: hydrate a singleton UserDto bag from a valid wire payload and
 *     apply ctx["signup.userId"] via setIdOnce().
 *   • Sad path: missing ctx["signup.userId"] yields a 500 precondition failure.
 *
 * Invariants:
 * - NO direct DTO construction. Short-lived UserDto for edge JSON must come from
 *   the shared UserDtoRegistry in @nv/shared — auth tests never depend on the
 *   user service's Registry or DB/index hints.
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { BagItemWire } from "@nv/shared/registry/RegistryBase";

import { UserDtoRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";
import { ToBagUserHandler } from "./toBag.User";

const TEST_USER_ID_V4 = "550e8400-e29b-41d4-a716-446655440000";

export class ToBagUserTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.toBag.user.happy_and_sad";
  }

  public testName(): string {
    return "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and enforces signup.userId precondition";
  }

  /**
   * LDD-40: fresh ctx per scenario. This test runs two scenarios:
   *  - happy path
   *  - sad path (missing signup.userId)
   */
  protected async execute(): Promise<void> {
    await this.happyPath_singletonBagWithAppliedId();
    await this.sadPath_missingSignupUserIdPrecondition();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 1: happy path
  // ─────────────────────────────────────────────────────────────────────

  private async happyPath_singletonBagWithAppliedId(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-toBagUser-happy",
      dtoType: "user",
      op: "toBag.user",
      body: {
        items: [this.makeUserWireItem("0000001")],
      },
    });

    // Sign-up MOS: id is minted earlier in the pipeline; we seed it explicitly here.
    ctx.set("signup.userId", TEST_USER_ID_V4);

    // Let the rails run the handler.
    await this.runHandler({
      handlerCtor: ToBagUserHandler,
      ctx,
    });

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

  // ─────────────────────────────────────────────────────────────────────
  // Scenario 2: sad path (missing signup.userId)
  // ─────────────────────────────────────────────────────────────────────

  private async sadPath_missingSignupUserIdPrecondition(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-toBagUser-missingUserId",
      dtoType: "user",
      op: "toBag.user",
      body: {
        items: [this.makeUserWireItem("0000002")],
      },
    });

    // Intentionally DO NOT set ctx['signup.userId'] here.

    // Designed rails error scenario: EXPECT a 500 from the handler
    // due to missing signup.userId precondition.
    await this.runHandler({
      handlerCtor: ToBagUserHandler,
      ctx,
      expectedError: true,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    // For handler-level tests we prefer response.status, but fall back to status.
    const rawResponseStatus = ctx.get<number>("response.status");
    const statusCode =
      rawResponseStatus !== undefined
        ? rawResponseStatus
        : ctx.get<number>("status");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when signup.userId is missing"
    );

    this.assertEq(
      String(statusCode ?? ""),
      "500",
      "status should be 500 for missing signup.userId precondition"
    );

    // NOTE:
    // At handler level there is no controller building response.body/problem.
    // problem.title/stage/requestId live at the controller layer and should be
    // asserted in controller tests, not handler tests.
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helper: build User wire item via shared UserDtoRegistry
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
  private makeUserWireItem(suffix: string): BagItemWire {
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
}
