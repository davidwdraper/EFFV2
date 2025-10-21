// backend/services/shared/src/security/Minter.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0036 — Token Minter using GCP KMS Sign
 * - ADR-0035 — JWKS Service for Public Keys (kid/alg expectations)
 *
 * Purpose (single concern):
 * - Mint signed JWTs via an injected signer.
 *
 * Invariants:
 * - No environment reads, no caching, no transport concerns here.
 * - Fail-fast on invalid input; do not swallow signer errors.
 * - Requests are flat bodies; responses elsewhere use the shared envelope (frozen plumbing).
 */

import { randomUUID } from "node:crypto";

/** Minimal logger shape to avoid coupling. */
type LoggerLike = {
  debug?: (o: Record<string, unknown>, msg?: string) => void;
  info?: (o: Record<string, unknown>, msg?: string) => void;
  warn?: (o: Record<string, unknown>, msg?: string) => void;
  error?: (o: Record<string, unknown>, msg?: string) => void;
};

/** Contract for any JWT signer used by the Minter. */
export interface IJwtSigner {
  /** e.g., "RS256" */
  alg(): string;
  /** Deterministic key id that matches JWKS entries. */
  kid(): string;
  /**
   * Produce a compact JWS given a header & claims payload.
   * Implementations must not mutate header/payload.
   */
  sign(
    header: Record<string, unknown>,
    payload: Record<string, unknown>
  ): Promise<string>;
}

/** Options required to mint a token. */
export type MintOptions = {
  /** Time-to-live in seconds (required). */
  ttlSec: number;
  /** Audience the token is intended for (required). */
  aud: string;
  /** Subject/principal (optional). */
  sub?: string;
  /** Issuer (optional). */
  iss?: string;
  /**
   * Negative/positive skew seconds for nbf; typically small positive to tolerate clock drift.
   * If omitted, nbf === iat.
   */
  nbfSkewSec?: number;
  /** Reserved for future strategies; ignored by Minter. */
  type?: "s2s" | "client" | "internal";
  /** Additional non-registered claims (opaque to transport). */
  extra?: Record<string, unknown>;
};

/** Result returned by a successful mint. */
export type MintResult = {
  jwt: string;
  header: { alg: string; kid: string };
  claims: Record<string, unknown>;
  issuedAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
};

export class Minter {
  private readonly signer: IJwtSigner;
  private readonly now: () => number;
  private readonly log?: LoggerLike;

  constructor(deps: {
    signer: IJwtSigner;
    now?: () => number;
    log?: LoggerLike;
  }) {
    if (!deps || !deps.signer) throw new Error("[Minter] signer is required");
    this.signer = deps.signer;
    // Clock is injectable for deterministic tests.
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = deps.log;
  }

  /**
   * Mint a signed JWT using the injected signer.
   * - Computes iat, nbf (with optional skew), exp, jti.
   * - Merges registered claims with user-provided `extra` (without overwriting registered fields).
   * - Returns the compact JWT and useful metadata.
   */
  async mint(opts: MintOptions): Promise<MintResult> {
    this.assertOptions(opts);

    const issuedAt = this.now();
    const nbf = issuedAt - (opts.nbfSkewSec ?? 0);
    const expiresAt = issuedAt + opts.ttlSec;

    if (nbf > expiresAt) {
      throw new Error(
        "[Minter] nbf cannot be later than exp (reduce nbfSkewSec or increase ttlSec)"
      );
    }

    const header = Object.freeze({
      alg: this.signer.alg(),
      kid: this.signer.kid(),
      typ: "JWT",
    });

    // Registered claims (do not allow extra to clobber these)
    const baseClaims: Record<string, unknown> = {
      iat: issuedAt,
      nbf,
      exp: expiresAt,
      aud: opts.aud,
      ...(opts.iss ? { iss: opts.iss } : {}),
      ...(opts.sub ? { sub: opts.sub } : {}),
      jti: randomUUID(), // swap to shared UUID util when available
    };

    // Merge extra claims without clobbering registered ones
    const claims = Object.freeze({ ...(opts.extra ?? {}), ...baseClaims });

    this.log?.debug?.(
      {
        kid: String(header.kid),
        alg: String(header.alg),
        aud: opts.aud,
        ttlSec: opts.ttlSec,
      },
      "minter.mint: signing"
    );

    const jwt = await this.signer.sign(header, claims);

    this.log?.info?.(
      {
        kid: String(header.kid),
        alg: String(header.alg),
        aud: opts.aud,
        iat: issuedAt,
        exp: expiresAt,
      },
      "minter.mint: signed"
    );

    return {
      jwt,
      header: { alg: String(header.alg), kid: String(header.kid) },
      claims,
      issuedAt,
      expiresAt,
    };
  }

  /** Validate options (void-returning; throws on invalid). */
  private assertOptions(opts: MintOptions): void {
    if (!opts) throw new Error("[Minter] options are required");

    if (
      typeof opts.ttlSec !== "number" ||
      !Number.isFinite(opts.ttlSec) ||
      opts.ttlSec <= 0
    ) {
      throw new Error("[Minter] ttlSec must be a positive number");
    }
    if (!opts.aud || typeof opts.aud !== "string" || opts.aud.trim() === "") {
      throw new Error(
        "[Minter] aud is required and must be a non-empty string"
      );
    }
    if (
      opts.iss !== undefined &&
      (typeof opts.iss !== "string" || opts.iss.trim() === "")
    ) {
      throw new Error("[Minter] iss, if provided, must be a non-empty string");
    }
    if (
      opts.sub !== undefined &&
      (typeof opts.sub !== "string" || opts.sub.trim() === "")
    ) {
      throw new Error("[Minter] sub, if provided, must be a non-empty string");
    }
    if (
      opts.extra &&
      (typeof opts.extra !== "object" || Array.isArray(opts.extra))
    ) {
      throw new Error("[Minter] extra must be a plain object if provided");
    }
    if (
      opts.nbfSkewSec !== undefined &&
      (typeof opts.nbfSkewSec !== "number" || !Number.isFinite(opts.nbfSkewSec))
    ) {
      throw new Error(
        "[Minter] nbfSkewSec must be a finite number if provided"
      );
    }
  }
}
