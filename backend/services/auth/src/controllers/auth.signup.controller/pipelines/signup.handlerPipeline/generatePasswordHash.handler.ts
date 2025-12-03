// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/generatePasswordHash.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0043 (Hydration + Failure Propagation)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0066 (Password Hashing & Credential Storage) // (future ADR slot)
 *
 * Purpose:
 * - Take the cleartext password extracted earlier in the pipeline and derive:
 *   • A cryptographically strong random salt
 *   • A password hash derived from (password, salt)
 *   • Algo + params metadata suitable for UserAuthDto.hashAlgo/hashParamsJson
 * - Store all values into the HandlerContext for downstream handlers that will
 *   construct and persist a UserAuthDto in the auth storage worker.
 *
 * Invariants:
 * - Never log the cleartext password.
 * - Never store the cleartext password in ctx once hashing is complete.
 * - On success, ctx contains:
 *   • ctx["signup.hash"]
 *   • ctx["signup.hashAlgo"]
 *   • ctx["signup.hashParamsJson"]
 *   • ctx["signup.passwordCreatedAt"]
 */

import { randomBytes, scryptSync } from "crypto";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

export class GeneratePasswordHashHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected override async execute(): Promise<void> {
    const requestId = this.ctx.get<string>("requestId");
    const passwordClear = this.ctx.get<string | undefined>(
      "signup.passwordClear"
    );

    if (!passwordClear) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_missing_password",
        detail:
          "Auth signup pipeline expected ctx['signup.passwordClear'] to contain the cleartext password before hashing. " +
          "Dev: ensure extractPassword.handler.ts ran and stored the password under ctx['signup.passwordClear'].",
        status: 500,
        code: "AUTH_SIGNUP_MISSING_PASSWORD",
        requestId,
      });
      return;
    }

    // Do NOT log the password itself.
    this.log.debug(
      {
        requestId,
      },
      "auth.signup.generatePasswordHash: deriving salt and hash"
    );

    try {
      // 16 bytes of random salt, hex-encoded.
      const saltBytes = randomBytes(16);
      const saltHex = saltBytes.toString("hex");

      // Derive a key using scrypt. Parameters are fixed so behavior is identical across envs.
      const keyLen = 64;
      const key = scryptSync(passwordClear, saltHex, keyLen);
      const hashHex = key.toString("hex");

      const hashAlgo = "scrypt";
      const passwordCreatedAt = new Date().toISOString();

      const hashParams = {
        saltHex,
        keyLen,
        algo: hashAlgo,
      };

      const hashParamsJson = JSON.stringify(hashParams);

      // Store results for downstream handlers.
      this.ctx.set("signup.hash", hashHex);
      this.ctx.set("signup.hashAlgo", hashAlgo);
      this.ctx.set("signup.hashParamsJson", hashParamsJson);
      this.ctx.set("signup.passwordCreatedAt", passwordCreatedAt);

      // Optionally clear the cleartext password to reduce blast radius.
      this.ctx.set("signup.passwordClear", undefined);

      this.log.info(
        {
          requestId,
        },
        "auth.signup.generatePasswordHash: password hash and metadata derived"
      );

      this.ctx.set("handlerStatus", "success");
    } catch (err) {
      const message = (err as Error)?.message ?? "Unknown error";

      this.log.error(
        {
          requestId,
          error: message,
        },
        "auth.signup.generatePasswordHash: hashing failed"
      );

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_hash_failed",
        detail:
          "Auth signup failed while hashing the supplied password. " +
          "Ops: check Node crypto availability and container entropy sources.",
        status: 500,
        code: "AUTH_SIGNUP_HASH_FAILED",
        requestId,
        error: message,
      });
    }
  }
}
