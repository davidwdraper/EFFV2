// backend/services/shared/src/contracts/base/ContractBase.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Provide a single, idempotent, and self-describing base class
 *   for all shared S2S contracts.
 * - Each concrete contract subclass defines:
 *     1. A static CONTRACT_ID constant (e.g. "audit/entries@v1")
 *     2. Zod request/response schemas
 * - This enables runtime integrity checks ensuring both
 *   the sender and receiver are using the same shared contract.
 *
 * Behavior:
 * - Contract IDs are compile-time constants, never derived.
 * - getContractId() returns the static ID after shape validation.
 * - verify(id) fails fast if the caller’s header differs.
 */

import { z } from "zod";
import { assertContractId } from "../../svc/s2s/headers";

/** Abstract base class for all shared contracts. */
export abstract class ContractBase<TReq, TRes> {
  /** Immutable contract ID — subclasses must override with a literal constant. */
  public static readonly CONTRACT_ID: string; // ← was protected; must be public for static-side typing

  /** Zod schemas for request and response bodies. */
  public abstract readonly request: z.ZodType<TReq>;
  public abstract readonly response: z.ZodType<TRes>;

  /**
   * Returns the contract's immutable ID.
   * Validates syntax and presence before returning.
   */
  public static getContractId(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as typeof ContractBase & { CONTRACT_ID: string };
    if (!self.CONTRACT_ID) {
      throw new Error("ContractBase: subclass missing CONTRACT_ID");
    }
    assertContractId(self.CONTRACT_ID, "ContractBase");
    return self.CONTRACT_ID;
  }

  /**
   * Verifies that an incoming ID matches this contract’s declared ID.
   * Typically used by receivers during header validation.
   */
  public static verify(received: string): void {
    const expected = this.getContractId();
    const got = (received ?? "").trim();
    if (got !== expected) {
      const err = new Error("contract_id_mismatch");
      // optional diagnostics for upstream loggers
      (err as any).expected = expected;
      (err as any).received = got;
      throw err;
    }
  }
}
