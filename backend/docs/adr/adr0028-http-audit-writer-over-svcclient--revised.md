# adr0028-http-audit-writer-over-svcclient (Revised)

## Context
We already have `HttpAuditWriter` implemented. Writers are **not** selected via a factory or env flag; they’re **constructed and dependency-injected** into the WAL engine by the **owning service** (Gateway here). The goal is simply: Gateway (and its WAL Replayer) uses `HttpAuditWriter` to POST audit entries to the Audit service via the **shared SvcClient**. Contracts: single RouterBase envelope; facilitator resolve body is flat `{ slug, version, baseUrl, outboundApiPrefix, etag }`. No compatibility branches, no literals.

## Decision
- The Gateway composes its WAL stack by **injecting** an instance of `HttpAuditWriter` into its `WalEngine` at boot.
- `HttpAuditWriter.writeBatch(entries)` performs:
  `SvcClient.callBySlug({ slug:"audit", version:1, path:"/entries", method:"POST", body:{ entries } })`.
- URL composition is done by **FacilitatorResolver** only (unwrap `data.body`, compose `baseUrl + outboundApiPrefix + "/" + slug + "/v" + version`). Gateway never hardcodes `/api` or versions.
- `app.ts` remains orchestration-only: assemble logger → svcClient singleton → wal (journal + replayer + **HttpAuditWriter**) → middleware → routes.

## Consequences
- No writer registry or env-based selection required; each service explicitly owns its writer wiring.
- WAL provides durability (FS journal), Replayer retries while Audit is unavailable.
- Dev == Prod behavior; values flow from env/mirror; zero literals.

## Implementation Notes
- Ensure `HttpAuditWriter` depends **only** on an abstract `SvcClientLike` and a logger; single concern.
- `HttpAuditWriter` must send **opaque** entries; no schema peeking.
- Facilitator resolve body must be **exactly** flat: `{ slug, version, baseUrl, outboundApiPrefix, etag }` with `/api` (no trailing slash).
- Gateway should obtain a **shared** `SvcClient` instance (e.g., `getSvcClient()`); do not build ad-hoc clients.
- `app.ts` wires in order: health → verifyS2S (workers) → body parsers → routes; resolve must not be blocked.

## Alternatives (rejected)
- Factory/registry of writers (unneeded surface area).
- Env-selected writer (`NV_AUDIT_WRITER=http`) — redundant; DI at composition time is clearer and safer.
- Direct `AUDIT_BASE_URL` — bypasses facilitator; breaks contract enforcement.

## Validation Checklist
- `curl $SVCFACILITATOR_BASE_URL/api/svcfacilitator/v1/resolve?...` returns RouterBase with flat body.
- Log line shows: `composedBase=http://<host>:<port>/api/audit/v1`.
- Gateway edge hit to `POST .../api/audit/v1/entries`.
- WAL Replayer flushes without “SvcClient missing/invalid” or resolve-shape errors.
