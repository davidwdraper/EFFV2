// backend/services/audit/src/handlers/entries.v1.bodyhandler.ts
/**
 * NowVibin (NV)
 * File: backend/services/audit/src/handlers/entries.v1.bodyhandler.ts
 *
 * Design/ADR References:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0029 — Contract-ID + BodyHandler pipeline (route-selected schema; header verification)
 * - ADR-0030 — ContractBase & idempotent contract identification
 * - ADR-0006 — Edge Logging (ingress-only; handler emits structured logs, not envelopes)
 *
 * WHY this file exists:
 * - This is the **domain seam** for Audit entries ingest. Transport (SvcReceiver/Router)
 *   should not parse or understand payload shape. The handler owns request/response
 *   validation (via the shared contract) and executes the minimal domain operation.
 *
 * WHY these choices:
 * - We extend a shared BodyHandlerBase so every endpoint follows the same
 *   parse-in → handle → validate-out pattern. This prevents drift and makes
 *   unit tests trivial and consistent across services.
 * - The handler depends on a narrow `AuditIngestPort` interface so storage
 *   can evolve independently (filesystem, DB, queue) without touching transport.
 */

import {
  BodyHandlerBase,
  type RequestContext,
} from "@nv/shared/svc/s2s/BodyHandlerBase";
import { AuditEntriesV1Contract } from "@nv/shared/contracts/audit/audit.entries.v1.contract";

/** WHY: Port abstraction keeps storage concerns out of the handler. */
export interface AuditIngestPort {
  /**
   * Persist a batch of opaque WAL entries; return how many were accepted.
   * WHY: Transport treats entries as opaque; only the audit domain interprets them.
   */
  ingest(entries: unknown[], ctx: RequestContext): Promise<number>;
}

// Local shapes derived from the shared contract (kept explicit for clarity)
type Req = { entries: unknown[] };
type Res = { accepted: number };

/**
 * AuditEntriesV1BodyHandler
 * WHY: Single-concern class — validates request/response according to the shared
 * contract and delegates the write to an injected port. No envelopes, no headers here.
 */
export class AuditEntriesV1BodyHandler extends BodyHandlerBase<
  Req,
  Res,
  typeof AuditEntriesV1Contract
> {
  constructor(
    private readonly port: AuditIngestPort,
    opts: { logger: RequestContext["logger"] }
  ) {
    // WHY: Contract class is passed to the base so it can expose schemas + ID consistently.
    super({ contract: AuditEntriesV1Contract, logger: opts.logger });
  }

  /**
   * WHY: Domain operation is intentionally boring: write and return a count.
   * Any enrichment (timestamps, actor, etc.) belongs in the domain layer,
   * not the transport glue.
   */
  protected async handle(ctx: RequestContext, req: Req): Promise<Res> {
    // Defensive check is unnecessary here because BodyHandlerBase already validated `req`
    // against the shared request schema. We rely on that invariant (one truth).
    const accepted = await this.port.ingest(req.entries, ctx);

    // WHY: Response is validated by the base after we return; we keep this DTO minimal.
    return { accepted };
  }
}
