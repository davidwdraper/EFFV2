adr0039-svcenv-centralized-nonsecret-env
# ADR-0039 — Centralized Non‑Secret Environment (svcenv)

## Context
- We want environment invariance and fail‑fast boots across all services.
- Non‑secret runtime configuration must be centrally managed, versioned, and auditable.
- Services should boot the same way in dev/stage/prod; only data differs.
- The current situation spreads values across `.env.*`; we will consolidate non‑secrets in **svcenv**.
- Index bootstrap must not hardcode hostnames/ports; the only bootstrap literal is the **root repo** `.env` value `SVCENV_URI` (temporary until svcenv itself is discoverable).

## Decision
- Create a dedicated **svcenv** service and **eff_svcenv_db** database to store **non‑secret** configuration per **env@slug@version**.
- Every service’s **index.ts** will call a **svcenv “current environment” endpoint first** to learn `env` (e.g., dev|stage|prod), then fetch that service’s variable set.
- The **AppBase** will mount a standard **runtime reload endpoint** so Ops can re-pull env without a deploy. Access requires `UserType >= 5 (AdminSystem)`.
- All environment data is represented by a **SvcEnvDto**. Callers never peel values out of ad‑hoc objects; they access via DTO getters.
- Initially (while building the template), a **shared svcenvClient** will return a **hard‑coded SvcEnvDto** with the final JSON shape to unblock template development.

## Consequences
- Single source of truth; easy edits via future Admin Console.
- Boot determinism; no per‑service literals; simpler triage.
- Adds a dependency on svcenv; we must design TTL caching and outage behavior.
- Strict separation of **secrets** (KMS/secret store) vs **non‑secrets** (svcenv).

## Implementation Notes

### Keying & Identity
- **Key:** `env@slug@version` (e.g., `dev@gateway@1`).
- `slug` is the singular service name; `version` is the **major** API version of that service.

### Data Model (Mongo: `svcenv` collection)
```json
{
  "_id": "dev@gateway@1",
  "slug": "gateway",
  "env": "dev",
  "version": 1,
  "updatedAt": "2025-10-25T00:00:00.000Z",
  "updatedByUserId": "admin-123",
  "vars": {
    "NV_GATEWAY_PORT": "4000",
    "FORCE_HTTPS": "false",
    "SVCENV_TTL_MS": "30000",
    "SVCFACILITATOR_SLUG": "svcfacilitator"
  },
  "notes": "Non-secret runtime config only."
}
```

**Invariants**
- Non‑secret keys only. Secrets live in KMS/secret store (or `.env.*` in local dev).
- `vars` is a flat `Record<string,string>`; no nested structures.
- Each consuming service defines a Zod **EnvSchema**; on boot, we `parse(vars)` and **exit(1)** on any failure.

### svcenv Service — Contracts (shared)
`services/shared/src/contracts/svcenv.contract.ts`

- `GET /api/svcenv/v1/env/current` → `{ ok: true, env: "dev" }`
- `GET /api/svcenv/v1/config?slug=<slug>&version=<n>&env=<env>` → `{ ok: true, key: "env@slug@version", vars: Record<string,string>, etag: string }`
- `PUT /api/svcenv/v1/config` (Admin only) → upsert document; responds `{ ok: true, key, etag }`
- `GET /api/svcenv/v1/health`

**Notes**
- All routes are **internalOnly=true**; S2S bearer required.
- `PUT /config` requires `minAccessLevel: 5` (AdminSystem+) via routePolicy.

### Boot Sequence (every service’s `index.ts`)
1) Read minimal bootstrap from root `.env` — **only** what’s needed to reach svcenv (e.g., `SVCENV_URI`).  
2) `svcenvClient.getCurrentEnv()` → `env`.  
3) `svcenvClient.getConfig({ slug, version, env })` → `vars`.  
4) Validate with the service’s Zod **EnvSchema**; **fail-fast** on error.  
5) Build **SvcEnvDto.fromJson({ key, vars, etag })** and inject into the app factory.  
6) Start the app. **log.info** each major step; **log.debug** counts, etag, TTLs (but never log secrets).

### AppBase Reload Endpoint
- Each service exposes `POST /api/<slug>/v1/env/reload` (internalOnly + `minAccessLevel: 5`).  
- Handler re-calls `svcenv` → validate → swap atomically → return `{ ok: true, reloadedAt, fromEtag, toEtag }`.
- Emit WAL audit event `ENV_RELOAD` with user id, old/new etags.

### Caching & Outage
- In‑memory cache with TTL: `SVCENV_TTL_MS`.  
- Cold‑start: **no silent fallbacks** — if svcenv is unreachable or validation fails → **exit(1)**.  
- Optional explicit **LKG** (last‑known‑good) file path may be supported later, guarded by an explicit flag (still logs WARN & SECURITY).

### Security & Policies
- svcenv is internal-only; requires S2S JWT from gateway or trusted services.  
- Reload and write endpoints require `UserType >= 5`.  
- RoutePolicy enforced via the shared policy gate.

### DTO & Client
- **DTO name:** `SvcEnvDto`  
  - If a DTO leaves a service boundary, define it under:  
    `services/shared/src/dto/<slug>.<purpose>.dto.ts`  
  - For svcenv’s public response DTO, place at:  
    `services/shared/src/dto/svcenv.config.dto.ts`
- **Shape (wire)**
```json
{
  "ok": true,
  "key": "dev@gateway@1",
  "vars": { "NV_GATEWAY_PORT": "4000", "FORCE_HTTPS": "false" },
  "etag": "W/\"b51a-7f4c...\""
}
```
- **Initial stub:** `svcenvClient` (shared) returns a **hard-coded** `SvcEnvDto` for `t_entity_crud` until the real svcenv service ships.

### Logging & Observability
- `log.info` before: resolving svcenv, fetching env, validating vars, committing reload, starting server.  
- `log.debug` for: durations, key counts, ttl values, etags, cache hits/misses.  
- `log.error` with guidance: include cause, expected action, and likely remediation (e.g., “Check SVCENV_URI; verify svcenv health; confirm route policy allows caller”).  
- Future Logger service: runtime log level control + optional stream to log DB.

### Definition of Done
- Shared contracts published.  
- `svcenvClient` stub returns DTO matching this ADR’s wire shape.  
- Template `index.ts` consumes `SvcEnvDto` and **fails fast** on invalid/missing keys.  
- AppBase exposes `/env/reload` with policy gate.  
- One consumer service boots exclusively from svcenv stub and passes smoke tests.

## Alternatives
- Keep `.env.*` per service — rejected (fragmented, non‑auditable, drift).  
- Push config into svcconfig only — rejected (mixes routing/service discovery with runtime knobs).

## References
- SOP “Environment Invariance (Critical)”.  
- Security & S2S: Only gateway public; S2S JWT required.  
- DTO‑first rule and file placement conventions.
