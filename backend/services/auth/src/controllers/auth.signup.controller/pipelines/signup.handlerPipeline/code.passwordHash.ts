// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.passwordHash.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0043 (Hydration + Failure Propagation)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0066 (Password Hashing & Credential Storage) // (future ADR slot)
 *
 * Purpose:
 * - Pull the cleartext password from the inbound HTTP header (controller-owned),
 *   derive:
 *   • A cryptographically strong random salt
 *   • A password hash derived from (password, salt)
 *   • Algo + params metadata suitable for UserAuthDto.hashAlgo/hashParamsJson
 * - Store only hashed credential outputs into ctx for downstream handlers.
 *
 * Invariants:
 * - Never log the cleartext password.
 * - Never store the cleartext password in ctx.
 * - On success, ctx contains:
 *   • ctx["signup.passwordHash"]
 *   • ctx["signup.passwordAlgo"]
 *   • ctx["signup.passwordHashParamsJson"]
 *   • ctx["signup.passwordCreatedAt"]
 *
 * Testing (dist-first sidecar):
 * - This handler does NOT import its sibling *.test.ts module.
 * - The test-runner loads "<handlerName>.test.js" from dist via require().
 */

import * as crypto from "crypto";
import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

type ScryptFn = (
  password: string,
  salt: string | Buffer,
  keylen: number
) => Buffer;

type HeaderReader = (name: string) => string | undefined;

export class CodePasswordHashHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Derive a password hash, salt, and metadata from the inbound signup password header and stash only the hashed credentials on the context.";
  }

  protected override handlerName(): string {
    return "code.passwordHash";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const headerName = "x-nv-password";
    const passwordClear = this.readHeader(headerName);

    if (!passwordClear) {
      this.failWithError({
        httpStatus: 400,
        title: "auth_signup_missing_password_header",
        detail: `Auth signup requires a cleartext password header. Missing or empty header: "${headerName}".`,
        stage: "inputs.passwordHeader",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ headerName, hasValue: false }],
        logMessage: `auth.signup.passwordHash: missing or empty password header "${headerName}".`,
        logLevel: "warn",
      });
      return;
    }

    // Optional injectable hash function, primarily for tests.
    const injectedFn = this.ctx.get<ScryptFn>("signup.passwordHashFn" as any);
    const scryptFn: ScryptFn =
      injectedFn && typeof injectedFn === "function"
        ? injectedFn
        : crypto.scryptSync;

    // 16 bytes of random salt, hex-encoded.
    const saltHex = crypto.randomBytes(16).toString("hex");

    // Derive a key using scrypt. Parameters are fixed so behavior is identical across envs.
    const keyLen = 64;

    let hashHex: string;
    try {
      const key = scryptFn(passwordClear, saltHex, keyLen);
      hashHex = key.toString("hex");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_hash_failed",
        detail:
          "Auth signup failed while hashing the supplied password. Ops: check Node crypto availability and container entropy sources.",
        stage: "hash.derive",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ algo: "scrypt", keyLen, message }],
        rawError: err,
        logMessage: "auth.signup.passwordHash: password hashing failed.",
        logLevel: "error",
      });
      return;
    }

    const hashAlgo = "scrypt";
    const passwordCreatedAt = new Date().toISOString();

    const hashParamsJson = JSON.stringify({
      saltHex,
      keyLen,
      algo: hashAlgo,
    });

    // Store results for downstream handlers.
    this.ctx.set("signup.passwordHash", hashHex);
    this.ctx.set("signup.passwordAlgo", hashAlgo);
    this.ctx.set("signup.passwordHashParamsJson", hashParamsJson);
    this.ctx.set("signup.passwordCreatedAt", passwordCreatedAt);

    // Critical: never stash cleartext.
    // (Nothing to clear because we never stored it.)

    this.ctx.set("handlerStatus", "ok");
  }

  /**
   * Controller-first header read.
   *
   * Contract:
   * - Handler may read request-only metadata/secrets directly from controller
   *   when no upstream handler could reasonably produce it.
   * - This must remain controller-owned (no direct Express req usage here).
   */
  private readHeader(name: string): string | undefined {
    const reader = this.resolveHeaderReader();
    const raw = reader(name);
    const v = typeof raw === "string" ? raw.trim() : "";
    return v ? v : undefined;
  }

  private resolveHeaderReader(): HeaderReader {
    const c: any = this.controller as any;

    // Preferred controller contracts (case-insensitive behavior belongs to controller).
    if (c && typeof c.tryHeader === "function") {
      return (name: string) => c.tryHeader(name);
    }
    if (c && typeof c.getHeader === "function") {
      return (name: string) => {
        try {
          return c.getHeader(name);
        } catch {
          return undefined;
        }
      };
    }
    if (c && typeof c.header === "function") {
      return (name: string) => c.header(name);
    }

    // Last-resort test compatibility: some runners stash headers onto ctx.
    // This is NOT a production contract; it exists to keep tests deterministic.
    return (name: string) => {
      const mapA = this.ctx.get<Record<string, any>>("http.headers" as any);
      const mapB = this.ctx.get<Record<string, any>>("headers" as any);
      const map = mapA && typeof mapA === "object" ? mapA : mapB;

      if (!map || typeof map !== "object") return undefined;

      const lower = name.toLowerCase();
      for (const k of Object.keys(map)) {
        if (String(k).toLowerCase() === lower) {
          const v = map[k];
          return typeof v === "string" ? v : String(v ?? "");
        }
      }
      return undefined;
    };
  }
}
