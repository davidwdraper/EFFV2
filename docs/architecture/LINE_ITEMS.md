# Architecture Line Items (Tagged, Append-Only)

> Format each fact as:
>
> - YYYY-MM-DDTHH:MM:SSZ [TAG] your fact here

# Seed entries (keep; append below)

- 2025-09-08T00:00:00Z [ROUTE] External path = /api/<slug>/<resource…>; gateway strips <slug>, forwards to service /api/<resource…>.
- 2025-09-08T00:00:00Z [XCUT-SEC] All non-health worker routes require S2S JWT (HS256, aud=internal-services, iss in {gateway,gateway-core}).
- 2025-09-08T00:00:00Z [BE-AUDIT] Gateway emits audit on res.finish; batches (≈200/200ms), WAL on gateway & audit; at-least-once with idempotent eventId.
- 2025-09-08T00:00:00Z [BILLING] Billable only when finalizeReason=finish AND status in 2xx/3xx; durationMs is observability, never billing.
- 2025-09-08T00:00:00Z [DATA] Mongo per service (OLTP); audit: unique {eventId:1}, time scans {ts:-1,\_id:-1}; future shard key = eventId.

# Append new facts below this line (one per line)
- 2025-09-08T23:53:04Z [ARCH][BE][AUDIT] Service starts AFTER WAL replay to avoid competing for DB IOPS.
- 2025-09-09T00:09:05Z [ARCH][BE][AUDIT] Health stays out of auditEvent.routes; service uses shared createHealthRouter at root.
- 2025-09-09T00:09:05Z [DESIGN][BE][AUDIT] preflightWALReplay(): run WAL replay before HTTP listen; idempotent upsert by eventId.
