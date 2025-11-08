// backend/services/shared/src/contracts/audit/audit.entries.v1.contract.ts
import { z } from "zod";
import { EnvelopeContract } from "../envelope.contract";

// ── Request schemas ─────────────────────────────────────────────────────────
const Target = z
  .object({
    slug: z.string().min(1),
    version: z.number().int().nonnegative(),
    route: z.string().min(1),
    method: z.string().min(1),
  })
  .strict();

const Meta = z
  .object({
    requestId: z.string().min(1),
    service: z.string().min(1),
    ts: z.number().int().nonnegative(),
  })
  .strict();

const BeginBlob = z
  .object({
    target: Target,
    phase: z.literal("begin"),
    note: z.string().optional(),
  })
  .strict();

const EndBlob = z
  .object({
    target: Target,
    phase: z.literal("end"),
    status: z.enum(["ok", "error"]),
    httpCode: z.number().int(),
    note: z.string().optional(),
  })
  .strict();

const Blob = z.discriminatedUnion("phase", [BeginBlob, EndBlob]);

export const AuditEntry = z
  .object({
    meta: Meta,
    blob: Blob,
  })
  .strict();

export const AuditEntriesRequest = z
  .object({
    entries: z.array(AuditEntry).min(1),
  })
  .strict();

// ── Response schema (for envelope .data.body) ───────────────────────────────
export const AuditEntriesResponse = z
  .object({
    accepted: z.number().int().nonnegative(),
  })
  .strict();

export type TAuditEntriesRequest = z.infer<typeof AuditEntriesRequest>;
export type TAuditEntriesResponse = z.infer<typeof AuditEntriesResponse>;

// ── Contract class (adds static CONTRACT_ID & verify) ───────────────────────
export class AuditEntriesV1Contract extends EnvelopeContract<TAuditEntriesResponse> {
  /** Static ID required by existing handler/type constraints */
  public static readonly CONTRACT_ID = "audit/entries@v1";

  static getContractId(): string {
    return this.CONTRACT_ID;
  }

  /** Static verifier required by handler’s generic constraint */
  static verify(received: string): void {
    const got = (received ?? "").trim();
    if (got !== this.CONTRACT_ID) {
      const err = new Error("contract_id_mismatch");
      // optional diagnostic fields some code paths may log
      (err as any).expected = this.CONTRACT_ID;
      (err as any).received = got;
      throw err;
    }
  }

  // Keep schemas discoverable on the instance
  public readonly request = AuditEntriesRequest;
  public readonly response = AuditEntriesResponse;
}
