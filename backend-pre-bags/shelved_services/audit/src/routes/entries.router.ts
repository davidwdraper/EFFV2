// backend/services/audit/src/routes/entries.router.ts
/**
 * NowVibin (NV)
 * File: backend/services/audit/src/routes/entries.router.ts
 *
 * Design/ADR References:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0006 — Edge Logging (ingress-only)
 * - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 * - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 * - ADR-0029 — Contract-ID + BodyHandler pipeline (headers; route-picked schema)
 * - ADR-0030 — ContractBase & idempotent contract identification
 *
 * WHY this file exists:
 * - This router is the orchestration seam for the Audit “entries” ingest endpoint.
 * - It enforces S2S invariants (contract header, success envelope) while keeping
 *   domain logic out of the transport layer. This makes failures precise and testable.
 *
 * WHY these choices:
 * - We verify the Contract-ID header BEFORE parsing so a drifting client fails fast,
 *   and so auth can key decisions off the contract identity later.
 * - We delegate request/response shape validation to a BodyHandler built on shared
 *   contracts. Routers shouldn’t know schemas; they wire components in the right order.
 * - We let SvcReceiver emit the canonical success envelope (one place, one shape),
 *   and return RFC7807 for errors. This removes drift between services.
 *
 * Mounting:
 * - App mounts this router under "/api/audit/v1". We DO NOT repeat the base here.
 *   (Environment invariance: paths are composed upstream; router owns only its leaf.)
 */

import { Router, type Router as IRouter } from "express";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";
import {
  HDR_NV_CONTRACT,
  HDR_NV_RESPONSE_CONTRACT,
} from "@nv/shared/svc/s2s/headers";
import { EnvelopeContract } from "@nv/shared/contracts/envelope.contract";
import { AuditEntriesV1Contract } from "@nv/shared/contracts/audit/audit.entries.v1.contract";
import type { AuditEntriesV1BodyHandler } from "../handlers/entries.v1.bodyhandler";

export class EntriesRouter {
  private readonly r: IRouter;
  private readonly receiver: SvcReceiver;

  constructor(private readonly handler: AuditEntriesV1BodyHandler) {
    this.r = Router();
    this.receiver = new SvcReceiver("audit");

    // WHY: Single, versioned endpoint. Keep it a one-liner here so the runtime
    // sequence is obvious: ingress → header check → handler.run → envelope.
    this.r.post("/entries", (req, res) =>
      this.receiver.receive(req as any, res as any, async (ctx) => {
        // WHY: Contract-ID proves the caller and receiver compiled against the same
        // shared schema. We compare against the subclass’ static, idempotent constant.
        const hdr = ctx.headers[HDR_NV_CONTRACT.toLowerCase()];
        if (!hdr) {
          // WHY: Explicit 400 is better than implicit parsing failures later.
          return {
            status: 400,
            body: { message: `missing ${HDR_NV_CONTRACT}` },
          };
        }
        try {
          AuditEntriesV1Contract.verify(hdr);
        } catch {
          // WHY: “contract_id_mismatch” is a precise signal for ops and tests.
          return { status: 400, body: { message: "contract_id_mismatch" } };
        }

        // WHY: Router does not parse domain. We delegate to the BodyHandler which:
        //  1) validates the request against the shared contract
        //  2) executes domain logic
        //  3) validates the response against the shared contract
        const { responseBody, responseContractId } = await this.handler.run(
          {
            requestId: ctx.requestId,
            now: () => new Date(),
            // WHY: Inject a logger from composition root in real app; console is a safe default.
            logger: {
              info: console.log,
              warn: console.warn,
              error: console.error,
            },
          },
          ctx.body
        );

        // WHY: Success responses must use the canonical RouterBase envelope.
        // SvcReceiver will finalize the envelope; we return only the domain body here.
        // We also surface the response contract in a header for observability/policy.
        const status = 200;
        const envelope = EnvelopeContract.makeOk("audit", status, responseBody);
        return {
          status,
          headers: { [HDR_NV_RESPONSE_CONTRACT]: responseContractId },
          body: envelope.data.body,
        };
      })
    );
  }

  /** WHY: Callers mount the prebuilt router to avoid duplicating route definitions. */
  public router(): IRouter {
    return this.r;
  }
}
