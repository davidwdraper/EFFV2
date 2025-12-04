// backend/services/shared/src/security/MintProvider.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0036 — Token Minter using GCP KMS Sign
 * - ADR-0035 — JWKS Service for Public Keys (kid/alg expectations)
 *
 * Purpose (single concern):
 * - Provide a TTL-aware, in-memory token provider that reuses tokens within
 *   their lifetime and rotates slightly early; exposes a tiny interface that
 *   SvcClient can depend on without knowing minting/signing details.
 *
 * Why:
 * - Slash KMS/HSM QPS and latency while keeping tokens short-lived.
 * - Keep caching logic OUT of the Minter and OUT of SvcClient.
 *
 * Invariants:
 * - No environment reads. All timing knobs are constructor-required.
 * - No fallbacks or defaults; fail-fast on bad options.
 * - Cache is namespaced by the signer (kid/alg) to prevent cross-key reuse.
 */

import type { Minter, MintOptions, MintResult, IJwtSigner } from "./Minter";
import { createHash } from "node:crypto";
import type { IBoundLogger } from "../logger/Logger";

/** Lightweight token types (inlined to avoid external interface file). */
export type TokenTuple = {
  aud: string;
  iss?: string;
  sub?: string;
  extra?: Record<string, unknown>;
};

export type TokenRequest = TokenTuple & {
  ttlSec: number;
  nbfSkewSec?: number;
};

export type TokenResult = {
  jwt: string;
  header: { alg: string; kid: string };
  issuedAt: number;
  expiresAt: number;
};

/** Optional public interface so other modules can type against it (no separate file). */
export interface ITokenProvider {
  getToken(req: TokenRequest): Promise<TokenResult>;
  invalidateTuple(t: TokenTuple): void;
  clearAll(): void;
}

export type MintProviderOptions = {
  /** Start rotating this many seconds before exp. */
  earlyRefreshSec: number;
  /** Clock tolerance when planning nbf/refresh (seconds). */
  clockSkewSec: number;
  /** Injected minter (no caching). */
  minter: Minter;
  /** Injected signer (for kid/alg in cache namespace). */
  signer: IJwtSigner;
  /** Optional logger and clock. */
  log?: IBoundLogger;
  now?: () => number; // epoch seconds
};

type CacheEntry = {
  result: MintResult;
  mintedAt: number; // epoch seconds (telemetry only)
};

export class MintProvider implements ITokenProvider {
  private readonly minter: Minter;
  private readonly signer: IJwtSigner;
  private readonly earlyRefreshSec: number;
  private readonly clockSkewSec: number;
  private readonly now: () => number;
  private readonly log?: IBoundLogger;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<MintResult>>();

  constructor(opts: MintProviderOptions) {
    this.assertOpts(opts);
    this.minter = opts.minter;
    this.signer = opts.signer;
    this.earlyRefreshSec = opts.earlyRefreshSec;
    this.clockSkewSec = opts.clockSkewSec;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = opts.log;

    this.log?.info(
      {
        kid: this.signer.kid(),
        alg: this.signer.alg(),
        earlyRefreshSec: this.earlyRefreshSec,
        clockSkewSec: this.clockSkewSec,
      },
      "MintProvider: initialized"
    );
  }

  /** Return a compact JWT (reuse within TTL, rotate early). */
  async getToken(req: TokenRequest): Promise<TokenResult> {
    this.assertRequest(req);

    const key = this.keyFor(req);
    const now = this.now();

    const cached = this.cache.get(key);
    if (cached) {
      const { result } = cached;
      if (now < result.expiresAt - this.earlyRefreshSec) {
        this.log?.debug(
          { kid: this.signer.kid(), aud: req.aud, exp: result.expiresAt, now },
          "MintProvider: cache hit"
        );
        return this.asTokenResult(result);
      }
      this.log?.debug(
        { kid: this.signer.kid(), aud: req.aud, exp: result.expiresAt, now },
        "MintProvider: early refresh window — rotating"
      );
    }

    const existing = this.inflight.get(key);
    if (existing) {
      this.log?.debug({ key }, "MintProvider: awaiting in-flight mint");
      const r = await existing;
      return this.asTokenResult(r);
    }

    const p = this.mintFresh(req)
      .then((res) => {
        this.cache.set(key, { result: res, mintedAt: now });
        return res;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    const fresh = await p;
    return this.asTokenResult(fresh);
  }

  /** Drop a tuple from cache (e.g., after 401/403), idempotent. */
  invalidateTuple(t: TokenTuple): void {
    const key = this.keyFor({
      aud: t.aud,
      iss: t.iss,
      sub: t.sub,
      extra: t.extra,
      // ttlSec/nbfSkewSec are irrelevant for keying
      ttlSec: 1,
    });
    this.cache.delete(key);
    this.log?.info({ key }, "MintProvider: invalidated tuple");
  }

  /** Optional admin hook: clear everything (e.g., after key rotation). */
  clearAll(): void {
    this.cache.clear();
    this.inflight.clear();
    this.log?.warn({}, "MintProvider: cache cleared");
  }

  // ----------------
  // Internals
  // ----------------

  private async mintFresh(req: TokenRequest): Promise<MintResult> {
    const started = this.now();
    this.log?.debug(
      {
        kid: this.signer.kid(),
        alg: this.signer.alg(),
        aud: req.aud,
        ttlSec: req.ttlSec,
        nbfSkewSec: req.nbfSkewSec ?? this.clockSkewSec,
      },
      "MintProvider: mint begin"
    );

    const res = await this.minter.mint({
      ttlSec: req.ttlSec,
      aud: req.aud,
      iss: req.iss,
      sub: req.sub,
      nbfSkewSec: req.nbfSkewSec ?? this.clockSkewSec,
      extra: req.extra,
    } as MintOptions);

    const ended = this.now();
    this.log?.info(
      {
        kid: res.header.kid,
        alg: res.header.alg,
        aud: req.aud,
        iat: res.issuedAt,
        exp: res.expiresAt,
        tookMs: (ended - started) * 1000,
      },
      "MintProvider: mint ok"
    );
    return res;
  }

  private asTokenResult(res: MintResult): TokenResult {
    return {
      jwt: res.jwt,
      header: res.header,
      issuedAt: res.issuedAt,
      expiresAt: res.expiresAt,
    };
  }

  /** Compose a stable cache key per (signerKid, alg, aud, iss, sub, extraHash). */
  private keyFor(t: TokenTuple & { ttlSec: number }): string {
    const kid = this.signer.kid();
    const alg = this.signer.alg();
    const extraHash = this.hashObj(t.extra ?? {});
    return `kid=${kid}|alg=${alg}|aud=${t.aud}|iss=${t.iss ?? ""}|sub=${
      t.sub ?? ""
    }|x=${extraHash}`;
    // Note: ttlSec intentionally excluded → reuse within TTL controlled by earlyRefreshSec.
  }

  private assertOpts(o: MintProviderOptions) {
    if (!o) throw new Error("[MintProvider] options are required");
    if (!o.minter) throw new Error("[MintProvider] minter is required");
    if (!o.signer) throw new Error("[MintProvider] signer is required");
    if (!Number.isFinite(o.earlyRefreshSec) || o.earlyRefreshSec <= 0) {
      throw new Error(
        "[MintProvider] earlyRefreshSec must be a positive number (sec)"
      );
    }
    if (!Number.isFinite(o.clockSkewSec) || o.clockSkewSec < 0) {
      throw new Error(
        "[MintProvider] clockSkewSec must be a non-negative number (sec)"
      );
    }
  }

  private assertRequest(t: TokenRequest) {
    if (!t) throw new Error("[MintProvider] token request is required");
    if (!t.aud || typeof t.aud !== "string") {
      throw new Error("[MintProvider] aud is required and must be a string");
    }
    if (!Number.isFinite(t.ttlSec) || t.ttlSec <= 0) {
      throw new Error("[MintProvider] ttlSec must be a positive number (sec)");
    }
    if (t.extra && (typeof t.extra !== "object" || Array.isArray(t.extra))) {
      throw new Error(
        "[MintProvider] extra must be a plain object if provided"
      );
    }
  }

  /** Deterministic hash of a plain object (sorted JSON). */
  private hashObj(o: Record<string, unknown>): string {
    const json = this.stableStringify(o);
    return createHash("sha256").update(json).digest("hex").slice(0, 16);
  }

  /** Stable stringify: sort keys recursively; handle arrays/values predictably. */
  private stableStringify(v: unknown): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v))
      return `[${v.map((x) => this.stableStringify(x)).join(",")}]`;
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    const pairs = keys.map(
      (k) => `${JSON.stringify(k)}:${this.stableStringify(o[k])}`
    );
    return `{${pairs.join(",")}}`;
  }
}
