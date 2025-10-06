// docs/adr/adr0016-logging-architecture-and-runtime-config.md

# ADR-0016 — Logging Architecture & Runtime Config (Logger + Log Service)

**Status:** Proposed — 2025-10-06  
**Owners:** Backend Core

## Context

We need (a) structured logging in every service, (b) DB persistence for selected logs, and (c) the ability for ops to enable/disable persistence per level at runtime in production — without redeploys.

## Decision

Introduce a two-part system:

1. **Shared Logger class** (in-process): single API with `.bind(ctx)`; emits logs to console (pino-compatible) and optionally forwards to the log service for persistence.
2. **Log Service (microservice)**: source of truth for **log configuration** (which levels/categories persist), exposes admin endpoints to change config at runtime, owns DB persistence and analytics export.

### Config Authority

- **Log Service** is the **single source of truth** for logging config.
- All services **fetch & cache** config (TTL), and **subscribe/poll** for changes (e.g., 30s TTL with jitter).
- On cache miss or service outage → **fail open to console**; persistence may be temporarily disabled.

### Levels & Categories

- Minimum levels: `debug`, `info`, `warn`, `error`, `security`, `audit`.
- Optional categories: `proxy`, `db`, `queue`, `s2s`, `auth`, `billing`.
- Config supports **level×category** toggles (persist on/off), with service overrides.

### Emission Rules

- Logger always writes to console (respecting process LOG_LEVEL).
- If config says “persist” for (level, category) → logger **enqueues** to WAL → **ships** to Log Service.

## Consequences

- ✅ Runtime control of persisted logs.
- ✅ Centralized analytics later (query DB).
- ⚠ Requires a lightweight client in every service (config fetch + WAL shipping).

## Implementation Notes

- **Shared Logger API** (`@nv/shared/logger/Logger.ts`):
  - `setRootLogger(pinoLike)`, `getLogger().bind(ctx).info|debug|…(obj, msg)`
  - Optional field: `category` in `obj`.
  - Integrates with **WAL** (ADR-0017) for durable ship.
- **Config Client** (in shared):
  - `LogConfigClient.get(service, version): LogConfig`
  - Caches with TTL; background refresh with jitter; circuit-breaker.
- **Log Service Endpoints**:
  - `GET /api/log/v1/config?service=gateway` → `{ persist: { level→bool or map }, overrides: {...} }`
  - `POST /api/log/v1/ingest` → batch [{ts, service, level, category, ctx, msg, data}]
  - `PATCH /api/log/v1/config` → admin-only; toggle persistence; returns new version
  - `GET /api/log/v1/health`
- **DB**: start simple (Postgres table or ClickHouse for volume). Partition by day. Index `(ts, service, level, category)`.
- **Security**: S2S JWT required for `/ingest` and `/config`; audit config changes.

## Alternatives

- Push-only config via envs → no runtime control.
- Ship logs directly from pino to DB → no central config or backpressure control.

## References

- ADR-0014 (Base Hierarchy), ADR-0015 (Logger with `.bind()`), ADR-0013 (Versioned Health)
