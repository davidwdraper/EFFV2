// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.extractPassword.test.ts
/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Verify CodeExtractPasswordHandler behavior for:
 *   • valid header (happy)
 *   • weak password (length)
 *   • missing password header
 *
 * Invariants:
 * - Tests must never log the raw password value; only length is inspected/logged.
 * - Handler-level tests assert handlerStatus + context mutations, not HTTP codes.
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { CodeExtractPasswordHandler } from "./code.extractPassword";

const HEADER_NAME = "x-nv-password";

/**
 * Canonical happy-path test:
 * - Used by handler.runTest() via CodeExtractPasswordTest.
 */
export class CodeExtractPasswordTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.extractPassword.happy";
  }

  public testName(): string {
    return "auth.signup: CodeExtractPasswordHandler extracts valid password";
  }

  protected expectedError(): boolean {
    // Happy-path smoke: handlerStatus !== "error".
    return false;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-extractPassword-happy",
      dtoType: "user",
      op: "code.extractPassword",
      headers: {
        [HEADER_NAME]: "StrongPassw0rd#",
      },
    });

    await this.runHandler({
      handlerCtor: CodeExtractPasswordHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    this.assertEq(
      String(handlerStatus ?? ""),
      "ok",
      "handlerStatus should be 'ok' on happy path"
    );

    const stored = ctx.get<string>("signup.passwordClear");
    this.assert(
      typeof stored === "string" && stored.length > 0,
      "signup.passwordClear should be stored as a non-empty string"
    );
  }
}

/**
 * Sad-path scenario: weak password
 * - Password present but fails ValidatePassword.
 * - Expects:
 *   • handlerStatus = "error"
 *   • signup.passwordClear not set
 */
export class CodeExtractPasswordWeakTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.extractPassword.weak";
  }

  public testName(): string {
    return "auth.signup: CodeExtractPasswordHandler rejects weak password by length";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-extractPassword-weak",
      dtoType: "user",
      op: "code.extractPassword",
      headers: {
        [HEADER_NAME]: "short",
      },
    });

    await this.runHandler({
      handlerCtor: CodeExtractPasswordHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' for weak password"
    );

    const stored = ctx.get("signup.passwordClear");
    this.assert(
      typeof stored === "undefined",
      "signup.passwordClear must not be set for weak password"
    );
  }
}

/**
 * Sad-path scenario: missing header
 * - No password header at all.
 * - Expects:
 *   • handlerStatus = "error"
 *   • signup.passwordClear not set
 */
export class CodeExtractPasswordMissingTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.extractPassword.missing";
  }

  public testName(): string {
    return "auth.signup: CodeExtractPasswordHandler fails when password header is missing";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-extractPassword-missing",
      dtoType: "user",
      op: "code.extractPassword",
      headers: {}, // explicit empty bag: canonical "missing header" case
    });

    await this.runHandler({
      handlerCtor: CodeExtractPasswordHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when password header is missing"
    );

    const stored = ctx.get("signup.passwordClear");
    this.assert(
      typeof stored === "undefined",
      "signup.passwordClear must not be present when header is missing"
    );
  }
}

/**
 * ScenarioRunner entrypoint for the handler-level test-runner service.
 * Shape:
 *   - id
 *   - name
 *   - shortCircuitOnFail
 *   - expectedError
 *   - async run() → test.run()
 */
export async function getScenarios() {
  return [
    {
      id: "auth.signup.code.extractPassword.happy",
      name: "auth.signup: CodeExtractPasswordHandler extracts valid password",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        const test = new CodeExtractPasswordTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.code.extractPassword.weak",
      name: "auth.signup: CodeExtractPasswordHandler rejects weak password by length",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        const test = new CodeExtractPasswordWeakTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.code.extractPassword.missing",
      name: "auth.signup: CodeExtractPasswordHandler fails when password header is missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        const test = new CodeExtractPasswordMissingTest();
        return await test.run();
      },
    },
  ];
}
