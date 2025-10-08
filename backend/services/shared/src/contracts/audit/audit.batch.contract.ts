// backend/services/shared/src/contracts/audit/audit.batch.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Batch envelope for WAL flushes and network ingest.
 */

import { AuditContractBase } from "./audit.base.contract";
import {
  AuditEntryContract,
  type AuditEntryJson,
} from "./audit.entry.contract";

export interface AuditBatchJson {
  entries: AuditEntryJson[];
}

export class AuditBatchContract extends AuditContractBase<AuditBatchJson> {
  public readonly entries: AuditEntryContract[];

  public constructor(json: AuditBatchJson) {
    super();
    if (!Array.isArray(json.entries) || json.entries.length < 1) {
      throw new Error("entries: must be non-empty array");
    }
    this.entries = json.entries.map((e) =>
      e instanceof AuditEntryContract ? e : new AuditEntryContract(e)
    );
  }

  public static parse(input: unknown, ctx = "AuditBatch"): AuditBatchContract {
    const obj = AuditContractBase.ensurePlainObject(input, ctx);
    const entriesRaw = obj["entries"];
    if (!Array.isArray(entriesRaw) || entriesRaw.length < 1) {
      throw new Error("entries: must be non-empty array");
    }
    const entries = entriesRaw.map((e, i) =>
      AuditEntryContract.parse(e, `entries[${i}]`)
    );
    return new AuditBatchContract({ entries: entries.map((x) => x.toJSON()) });
  }

  public toJSON(): AuditBatchJson {
    return { entries: this.entries.map((e) => e.toJSON()) };
  }
}
