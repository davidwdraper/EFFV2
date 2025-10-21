// backend/services/shared/src/security/KmsJwtSigner.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0036 — Token Minter using GCP KMS Sign
 * - ADR-0035 — JWKS Service for Public Keys (kid/alg expectations)
 *
 * Purpose (single concern):
 * - Use Google Cloud KMS to produce detached JWS signatures.
 *
 * Invariants:
 * - DI-only; no env reads here (caller passes validated env).
 * - Deterministic KID: "kms:<project>:<location>:<ring>:<key>:v<version>".
 * - No caching; fail-fast on any signing error.
 *
 * Instrumentation:
 * - debug: "kms.sign.begin" with { kid, alg, keyName, dataB64uLen, timeoutMs }
 * - debug: "kms.sign.ok"    with { kid, tookMs, sigB64uLen }
 * - error: "kms.sign.error" with { kid, code, details, message }
 */

import { createHash } from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import type { IJwtSigner } from "./Minter";

/** Minimal logger shape to avoid coupling. */
type LoggerLike = {
  debug?: (o: Record<string, unknown>, msg?: string) => void;
  info?: (o: Record<string, unknown>, msg?: string) => void;
  warn?: (o: Record<string, unknown>, msg?: string) => void;
  error?: (o: Record<string, unknown>, msg?: string) => void;
};

type KmsEnv = {
  KMS_PROJECT_ID: string;
  KMS_LOCATION_ID: string;
  KMS_KEY_RING_ID: string;
  KMS_KEY_ID: string;
  KMS_KEY_VERSION: string;
  KMS_JWT_ALG: string; // e.g., "RS256"
};

type KmsSignerOptions = {
  /** Optional RPC timeout in milliseconds (applied to asymmetricSign call). */
  timeoutMs?: number;
  /** Optional logger; if omitted, signer is silent. */
  log?: LoggerLike;
  /** Injected clock for testability (ms). */
  nowMs?: () => number;
};

export class KmsJwtSigner implements IJwtSigner {
  private readonly client: KeyManagementServiceClient;
  private readonly keyName: string;
  private readonly algName: string;
  private readonly kidValue: string;
  private readonly timeoutMs?: number;
  private readonly log?: LoggerLike;
  private readonly nowMs: () => number;

  constructor(env: KmsEnv, opts: KmsSignerOptions = {}) {
    // Fail fast on incomplete env (defensive; caller should already validate)
    const missing: string[] = [];
    for (const k of [
      "KMS_PROJECT_ID",
      "KMS_LOCATION_ID",
      "KMS_KEY_RING_ID",
      "KMS_KEY_ID",
      "KMS_KEY_VERSION",
      "KMS_JWT_ALG",
    ] as const) {
      if (!(env as any)[k] || String((env as any)[k]).trim() === "") {
        missing.push(k);
      }
    }
    if (missing.length) {
      throw new Error(
        `[KmsJwtSigner] missing required env keys: ${missing.join(", ")}`
      );
    }

    this.client = new KeyManagementServiceClient();
    this.keyName = this.client.cryptoKeyVersionPath(
      env.KMS_PROJECT_ID,
      env.KMS_LOCATION_ID,
      env.KMS_KEY_RING_ID,
      env.KMS_KEY_ID,
      env.KMS_KEY_VERSION
    );
    this.algName = env.KMS_JWT_ALG;
    this.kidValue = `kms:${env.KMS_PROJECT_ID}:${env.KMS_LOCATION_ID}:${env.KMS_KEY_RING_ID}:${env.KMS_KEY_ID}:v${env.KMS_KEY_VERSION}`;

    this.timeoutMs = opts.timeoutMs;
    this.log = opts.log;
    this.nowMs = opts.nowMs ?? (() => Date.now());

    this.log?.info?.(
      {
        kid: this.kidValue,
        alg: this.algName,
        keyName: this.keyName,
        timeoutMs: this.timeoutMs ?? null,
      },
      "KmsJwtSigner: initialized"
    );
  }

  /** e.g., "RS256" */
  alg(): string {
    return this.algName;
  }

  /** Deterministic KID used in JWKS. */
  kid(): string {
    return this.kidValue;
  }

  /**
   * Create a compact JWS using KMS to sign `base64url(header) + "." + base64url(payload)`.
   * Returns the full compact JWT string: header.payload.signature
   */
  async sign(
    header: Record<string, unknown>,
    payload: Record<string, unknown>
  ): Promise<string> {
    // Defensive: don't mutate inputs; ensure alg/kid consistency.
    const hdrAlg = String((header as any).alg ?? "");
    const hdrKid = String((header as any).kid ?? "");
    if (hdrAlg && hdrAlg !== this.algName) {
      this.log?.warn?.(
        { headerAlg: hdrAlg, signerAlg: this.algName },
        "KmsJwtSigner: header.alg differs from signer.alg"
      );
    }
    if (hdrKid && hdrKid !== this.kidValue) {
      this.log?.warn?.(
        { headerKid: hdrKid, signerKid: this.kidValue },
        "KmsJwtSigner: header.kid differs from signer.kid"
      );
    }

    const b64u = (obj: Record<string, unknown>): string =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");

    const data = `${b64u(header)}.${b64u(payload)}`;
    const digest = createHash("sha256").update(data).digest();
    const began = this.nowMs();

    this.log?.debug?.(
      {
        kid: this.kidValue,
        alg: this.algName,
        keyName: this.keyName,
        dataB64uLen: data.length,
        digestLen: digest.byteLength,
        timeoutMs: this.timeoutMs ?? null,
      },
      "kms.sign.begin"
    );

    try {
      const [result] = await this.client.asymmetricSign(
        {
          name: this.keyName,
          digest: { sha256: digest },
        },
        // gRPC CallOptions (timeout applies to the RPC)
        this.timeoutMs ? { timeout: this.timeoutMs } : {}
      );

      const sigBuf = result.signature
        ? Buffer.from(result.signature as Uint8Array)
        : undefined;

      if (!sigBuf || sigBuf.byteLength === 0) {
        throw new Error("[KmsJwtSigner] KMS returned empty signature");
      }

      const signature = sigBuf.toString("base64url");
      const tookMs = this.nowMs() - began;

      this.log?.debug?.(
        {
          kid: this.kidValue,
          tookMs,
          sigB64uLen: signature.length,
        },
        "kms.sign.ok"
      );

      return `${data}.${signature}`;
    } catch (e: any) {
      const tookMs = this.nowMs() - began;

      // Surface RPC context that’s typically helpful for network / IAM issues
      const code = e?.code ?? null;
      const details = e?.details ?? null;
      const metadata =
        typeof e?.metadata?.getMap === "function"
          ? e.metadata.getMap()
          : undefined;

      this.log?.error?.(
        {
          kid: this.kidValue,
          alg: this.algName,
          keyName: this.keyName,
          tookMs,
          code,
          details,
          metadata,
          message: String(e?.message ?? e),
        },
        "kms.sign.error"
      );

      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}
