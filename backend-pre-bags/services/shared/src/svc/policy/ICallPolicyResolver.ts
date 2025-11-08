// backend/services/shared/src/svc/policy/ICallPolicyResolver.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0028/29/30 — SvcClient envelope & error discipline
 * - ADR-0036 — Token Minter using GCP KMS Sign
 *
 * Purpose (single concern):
 * - Define how SvcClient learns per-call policy (auth required, audience, TTL, etc.)
 *   without the caller hardcoding security details.
 *
 * Why:
 * - Centralizes “should this call be authenticated?” and “with what params?”
 * - Lets us swap sources (static map now → Facilitator svcconfig later) with zero changes to call sites.
 *
 * Invariants:
 * - No environment reads here (interface only).
 * - Resolver must return explicit values; SvcClient has **no fallbacks**.
 */

import type { SvcCallOptions } from "../../svc/types";

/** Minimal auth policy for a single outbound call. */
export type CallAuthPolicy = {
  /** If true, SvcClient MUST attach Authorization: Bearer <jwt>. If false, it MUST NOT. */
  requiresAuth: boolean;

  /** Audience for the minted token (required when requiresAuth=true). */
  aud?: string;

  /** Optional issuer/subject for the caller identity (service principal). */
  iss?: string;
  sub?: string;

  /** Token timing knobs (strongly recommended to be provided by the resolver). */
  ttlSec?: number;
  nbfSkewSec?: number;

  /**
   * Extra claims for minting (deterministic content only).
   * Keep small; transport plumbing never peeks inside.
   */
  extra?: Record<string, unknown>;
};

/**
 * Resolve policy for an outbound call.
 * Implementations may consult static tables, svcconfig via Facilitator, etc.
 */
export interface ICallPolicyResolver {
  resolve(
    opts: Pick<SvcCallOptions, "slug" | "version" | "path" | "method">
  ): Promise<CallAuthPolicy>;
}
