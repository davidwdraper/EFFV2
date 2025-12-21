// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.passwordHash.test.ts
/**
 * Docs:
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0040 (DTO-Only Persistence; edge → DTO)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Provide THREE handler-test scenarios for CodePasswordHashHandler:
 *   • Happy path: hash derived from ctx['signup.passwordClear'].
 *   • Missing cleartext password: handler fails with 500 precondition error.
 *   • Hash failure: simulated scrypt error yields a 500 hash-derive failure.
 */

import * as crypto from "crypto";
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { CodePasswordHashHandler } from "./code.passwordHash";

export class CodePasswordHashHappyTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.passwordHash.happy";
  }

  public testName(): string {
    return "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password";
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-passwordHash-happy",
      dtoType: "user",
      op: "code.passwordHash",
    });

    // Seed the cleartext password as produced by the previous handler.
    ctx.set("signup.passwordClear", "StrongPassw0rd#");

    await this.runHandler({
      handlerCtor: CodePasswordHashHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    this.assertEq(String(handlerStatus ?? ""), "ok");

    const hash = ctx.get<string>("signup.hash");
    const algo = ctx.get<string>("signup.hashAlgo");
    const paramsJson = ctx.get<string>("signup.hashParamsJson");
    const createdAt = ctx.get<string>("signup.passwordCreatedAt");
    const passwordClear = ctx.get("signup.passwordClear");

    this.assert(
      typeof hash === "string" && hash.length > 0,
      "signup.hash should be a non-empty string"
    );
    this.assertEq(algo ?? "", "scrypt", "hash algorithm should be 'scrypt'");

    this.assert(
      typeof paramsJson === "string" && paramsJson.length > 0,
      "signup.hashParamsJson should be a non-empty JSON string"
    );

    this.assert(
      typeof createdAt === "string" && createdAt.length > 0,
      "signup.passwordCreatedAt should be a non-empty ISO timestamp"
    );

    this.assert(
      typeof passwordClear === "undefined",
      "signup.passwordClear must be cleared after hashing"
    );
  }
}

export class CodePasswordHashMissingPasswordTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.passwordHash.missingPassword";
  }

  public testName(): string {
    return "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-passwordHash-missingPassword",
      dtoType: "user",
      op: "code.passwordHash",
    });

    // Intentionally do NOT seed ctx['signup.passwordClear'].

    await this.runHandler({
      handlerCtor: CodePasswordHashHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const rawResponseStatus = ctx.get<number>("response.status");
    const statusCode =
      rawResponseStatus !== undefined
        ? rawResponseStatus
        : ctx.get<number>("status");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when signup.passwordClear is missing"
    );
    this.assertEq(
      String(statusCode ?? ""),
      "500",
      "status should be 500 for missing signup.passwordClear precondition"
    );
  }
}

export class CodePasswordHashFailureTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.passwordHash.hashFailure";
  }

  public testName(): string {
    return "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)";
  }

  protected expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-passwordHash-failure",
      dtoType: "user",
      op: "code.passwordHash",
    });

    // Seed a valid cleartext password as the previous handler would.
    ctx.set("signup.passwordClear", "AnotherStrongPass#1");

    // Instead of monkey-patching crypto.scryptSync (which is a non-writable
    // accessor in modern Node and causes "only a getter" errors), inject a
    // custom hash function via the context hook the handler already supports.
    ctx.set("signup.passwordHashFn", ((
      password: string,
      salt: string | Buffer,
      keylen: number
    ): Buffer => {
      // Simulate a low-level scrypt failure.
      throw new Error("TEST_FORCED_SCRYPT_FAILURE");
    }) as typeof crypto.scryptSync);

    await this.runHandler({
      handlerCtor: CodePasswordHashHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const rawResponseStatus = ctx.get<number>("response.status");
    const statusCode =
      rawResponseStatus !== undefined
        ? rawResponseStatus
        : ctx.get<number>("status");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when scrypt hashing fails"
    );
    this.assertEq(
      String(statusCode ?? ""),
      "500",
      "status should be 500 when hashing fails"
    );

    // Hash-related outputs should not be validly populated on failure.
    const hash = ctx.get("signup.hash");
    this.assert(
      typeof hash === "undefined" || hash === null,
      "signup.hash should not be set on hash failure"
    );
  }
}

/**
 * Alias used by CodePasswordHashHandler.runTest().
 * Handler rails and the test-runner both rely on the same scenario wiring.
 */
export { CodePasswordHashHappyTest as CodePasswordHashTest };

/**
 * ScenarioRunner entrypoint: used by the handler-level test-runner service.
 */
export async function getScenarios() {
  return [
    {
      id: "auth.signup.code.passwordHash.happy",
      name: "auth.signup: CodePasswordHashHandler derives hash, algo, params, and clears cleartext password",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        const test = new CodePasswordHashHappyTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.code.passwordHash.missingPassword",
      name: "auth.signup: CodePasswordHashHandler fails when signup.passwordClear is missing",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        const test = new CodePasswordHashMissingPasswordTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.code.passwordHash.hashFailure",
      name: "auth.signup: CodePasswordHashHandler reports 500 when hashing fails (scrypt error)",
      shortCircuitOnFail: false,
      expectedError: true,
      async run() {
        const test = new CodePasswordHashFailureTest();
        return await test.run();
      },
    },
  ];
}
