// backend/services/shared/src/contracts/audit/audit.entries.v1.contract.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *   - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Canonical shared contract for Audit ingest (entries) v1.
 * - Used by both Gateway (client) and Audit (receiver) — same class, same ID.
 *
 * ContractId:
 * - Static, idempotent, compile-time constant: "audit/entries@v1"
 * - Sent by client in `X-NV-Contract`; verified by receiver before parsing.
 */

import { z } from "zod";
import { ContractBase } from "../base/ContractBase";

export class AuditEntriesV1Contract extends ContractBase<
  { entries: unknown[] },
  { accepted: number }
> {
  /** Idempotent, literal Contract ID */
  protected static readonly CONTRACT_ID = "audit/entries@v1" as const;

  /** Request schema: opaque list of WAL entries (transport does not peek). */
  public readonly request = z.object({
    entries: z
      .array(z.unknown())
      .min(1, "entries must contain at least one item"),
  });

  /** Response schema: boring and testable — count only. */
  public readonly response = z.object({
    accepted: z.number().int().min(0),
  });
}
