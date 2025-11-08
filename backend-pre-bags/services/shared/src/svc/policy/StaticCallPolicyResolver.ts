// backend/services/shared/src/svc/policy/StaticCallPolicyResolver.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0028/29/30 — SvcClient envelope & error discipline
 * - ADR-0036 — Token Minter using GCP KMS Sign
 *
 * Purpose (single concern):
 * - Provide a DI-friendly, **explicit** static policy resolver so callers of SvcClient
 *   do not hardcode security. No env reads, no fallbacks.
 *
 * Why:
 * - Baby-steps: declare per-slug (and optional per-path/method) policies here now.
 *   Swap later for a Facilitator-backed resolver with zero call-site changes.
 *
 * Invariants:
 * - No defaults. If a call’s (slug,version,path,method) has no matching rule → fail-fast.
 * - Most-specific rule wins (version > method > longest pathPrefix). Ties → fail-fast.
 * - `requiresAuth=true` MUST include `aud` and `ttlSec` at minimum.
 */

import type {
  ICallPolicyResolver,
  CallAuthPolicy,
} from "./ICallPolicyResolver";
import type { SvcCallOptions } from "../types";

type LoggerLike = {
  debug?: (o: Record<string, unknown>, msg?: string) => void;
  info?: (o: Record<string, unknown>, msg?: string) => void;
  warn?: (o: Record<string, unknown>, msg?: string) => void;
  error?: (o: Record<string, unknown>, msg?: string) => void;
};

export type StaticRule = {
  /** Required: service slug this rule applies to (e.g., "user", "jwks"). */
  slug: string;
  /** Optional: exact major version (e.g., 1). If omitted, applies to any version. */
  version?: number;
  /** Optional: HTTP method filter (e.g., "GET"). If omitted, any method. */
  method?: string;
  /**
   * Optional: path prefix (relative to the service base). Match is case-sensitive.
   * Example: "keys", "users", "admin/metrics".
   */
  pathPrefix?: string;
  /** The policy to apply when this rule matches. */
  policy: CallAuthPolicy;
};

export type StaticCallPolicyResolverOptions = {
  rules: StaticRule[];
  log?: LoggerLike;
};

export class StaticCallPolicyResolver implements ICallPolicyResolver {
  private readonly rules: StaticRule[];
  private readonly log?: LoggerLike;

  constructor(opts: StaticCallPolicyResolverOptions) {
    if (!opts || !Array.isArray(opts.rules)) {
      throw new Error("[StaticCallPolicyResolver] rules are required");
    }
    if (opts.rules.length === 0) {
      throw new Error(
        "[StaticCallPolicyResolver] at least one rule is required"
      );
    }
    // Validate each rule upfront
    for (const r of opts.rules) {
      this.assertRule(r);
    }
    this.rules = opts.rules.slice();
    this.log = opts.log;
    this.log?.info?.(
      { count: this.rules.length },
      "StaticCallPolicyResolver: initialized"
    );
  }

  public async resolve(
    opts: Pick<SvcCallOptions, "slug" | "version" | "path" | "method">
  ): Promise<CallAuthPolicy> {
    const method = (opts.method ?? "GET").toUpperCase();
    const candidates = this.rules.filter((r) => {
      if (r.slug !== opts.slug) return false;
      if (typeof r.version === "number" && r.version !== (opts.version ?? 1))
        return false;
      if (r.method && r.method.toUpperCase() !== method) return false;
      if (r.pathPrefix && !this.pathStartsWith(opts.path ?? "", r.pathPrefix))
        return false;
      return true;
    });

    if (candidates.length === 0) {
      const msg =
        `[StaticCallPolicyResolver] no policy for slug='${opts.slug}' v${
          opts.version ?? 1
        } ` + `method='${method}' path='${opts.path ?? ""}'`;
      this.log?.error?.({}, msg);
      throw new Error(msg);
    }

    // Choose the most specific rule:
    //  - version-specific beats version-agnostic (v score)
    //  - method-specific beats any-method (m score)
    //  - longer pathPrefix beats shorter/none (p score by length)
    //  - slug is already equal for all
    let best: StaticRule | null = null;
    let bestScore = -1;
    for (const r of candidates) {
      const v = typeof r.version === "number" ? 1 : 0;
      const m = r.method ? 1 : 0;
      const p = r.pathPrefix ? r.pathPrefix.length : 0;
      const score = v * 1000 + m * 100 + p; // weights ensure consistent ordering
      if (score > bestScore) {
        best = r;
        bestScore = score;
      } else if (score === bestScore) {
        const msg =
          `[StaticCallPolicyResolver] ambiguous policy for slug='${
            opts.slug
          }' v${opts.version ?? 1} ` +
          `method='${method}' path='${
            opts.path ?? ""
          }' (two rules have same specificity)`;
        this.log?.error?.({}, msg);
        throw new Error(msg);
      }
    }

    // At this point best is defined and validated
    const policy = best!.policy;

    // Hard guard: when auth is required, we must have aud and ttlSec
    if (policy.requiresAuth) {
      if (!policy.aud || !Number.isFinite(policy.ttlSec!)) {
        const msg =
          `[StaticCallPolicyResolver] invalid policy for slug='${opts.slug}': ` +
          `requiresAuth=true but missing aud and/or ttlSec`;
        this.log?.error?.({}, msg);
        throw new Error(msg);
      }
    }

    this.log?.debug?.(
      {
        slug: opts.slug,
        version: opts.version ?? 1,
        method,
        path: opts.path ?? "",
        requiresAuth: policy.requiresAuth,
        aud: policy.aud,
        ttlSec: policy.ttlSec,
      },
      "policy resolved"
    );

    return policy;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private pathStartsWith(actual: string, prefix: string): boolean {
    const a = (actual || "").replace(/^\/+/, "");
    const p = (prefix || "").replace(/^\/+/, "");
    return a === p || a.startsWith(p.endsWith("/") ? p : p + "/");
  }

  private assertRule(r: StaticRule) {
    if (!r || typeof r !== "object")
      throw new Error("[StaticCallPolicyResolver] rule must be an object");
    if (!r.slug || typeof r.slug !== "string")
      throw new Error("[StaticCallPolicyResolver] rule.slug is required");
    if (r.method && typeof r.method !== "string")
      throw new Error("[StaticCallPolicyResolver] rule.method must be string");
    if (r.pathPrefix && typeof r.pathPrefix !== "string")
      throw new Error(
        "[StaticCallPolicyResolver] rule.pathPrefix must be string"
      );
    if (r.version !== undefined && !Number.isFinite(r.version))
      throw new Error(
        "[StaticCallPolicyResolver] rule.version must be a number if provided"
      );
    if (!r.policy || typeof r.policy !== "object")
      throw new Error("[StaticCallPolicyResolver] rule.policy is required");
    if (typeof r.policy.requiresAuth !== "boolean")
      throw new Error(
        "[StaticCallPolicyResolver] rule.policy.requiresAuth must be boolean"
      );
    // We do NOT require aud/ttlSec here; that’s validated at resolve() time only when requiresAuth=true
  }
}
