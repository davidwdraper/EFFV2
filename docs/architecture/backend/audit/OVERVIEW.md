# Audit Service — Design (How)

Why:

- Authoritative ledger for billing & forensics; at-least-once network, exactly-once effect (idempotent `eventId`).

Intake:

- Endpoint: `PUT /api/audit/events` (single or batch)
- Validate via DTO → WAL append (NDJSON) → enqueue → bulk upsert (idempotent)
- Return 202 Accepted with `{ok, received, requestId}`

Contract (shared):

- Fields: eventId, tsStart?, ts, durationMs, durationReliable?, finalizeReason?, requestId, method, path, slug, status, ip/ua/contentType, bytesIn/bytesOut, bodyHash/respHash?, pii?, billableUnits, billingAccountId?, billingSubaccountId?, planId?, meta?

Semantics:

- `finalizeReason=finish|timeout|client-abort|shutdown-replay`
- `billableUnits=1` only when `finish` and 2xx/3xx; otherwise 0
- `durationReliable=true` only when `finish`

Durability:

- WAL append-before-queue; boot replayer scans `var/audit-wal/*.ndjson` oldest-first and bulk-upserts

DB writes:

- `$setOnInsert` only; unique index on `eventId`; `ordered:false` bulk writes

Read API (internal):

- `getByEventId(eventId)`
- `listEvents({fromTs,toTs,slug,requestId,userSub,finalizeReason,statusMin,statusMax,limit,cursor})`

Scaling pointers:

- See `/docs/architecture/backend/SCALING.md#audit-focused`
