adr0044-svcenv-dto-kv-contract
# ADR‑0044 — SvcEnv as DTO (Key/Value Contract)

## Context
We are standardizing **all** data movement in NowVibin on DTOs. Environment configuration is no exception.
The `svcenvClient` will fetch an **opaque** `SvcEnvDto` from the svcenv service. The client must **not**
know which variables exist. Any service or adapter that needs a value must ask the DTO by **key**.

Historically, some adapters reached into `SvcEnvDto` via specific getters (e.g., `mongoDbName()`), or they
expected specific field names (e.g., `NV_MONGO_URI`). That couples adapters to the DTO’s internals and
creates drift when keys change.

## Decision
1. `SvcEnvDto` exposes a **generic key/value API**:
   - `getEnvVar(key: string): string` — returns the value or throws a descriptive error (no defaults).
   - `tryEnvVar(key: string): string | undefined` — returns value or `undefined` (never logs).
   - `hasEnvVar(key: string): boolean`
   - `listEnvVars(): string[]`
   - `etag: string | undefined` (metadata passthrough)

2. **No adapter** may depend on DTO‑specific getters or fields. All access must go through the generic API.

3. For transition, `getVar(key)` remains as a **temporary alias** to `getEnvVar(key)`.
   It will be removed after all callers migrate.

4. **No silent fallbacks**. If a key is required, callers must use `getEnvVar(key)` and allow the failure
   to surface with an actionable message.

5. Key naming is a separate concern. Adapters can define the keys they require, but they **must** fetch
   them via the generic API, never via DTO fields.

## Consequences
- Adapters become stable across svcenv schema changes; only key strings matter.
- DTO remains the single source of truth and validates its own data.
- Failures are crisp and actionable; no hidden defaults or environment leakage.

## Implementation Notes
- `SvcEnvDto` stores env vars in an internal `Map<string,string>` built from the `vars` object it receives.
- Throwing path: `getEnvVar` throws an `Error` with the **key name**, service slug, and DTO `etag` if available.
- `ControllerBase` and `AppBase` do not care about individual keys; they pass the DTO through.
- Mongo adapter example (pseudocode):

```ts
const uri = svcEnv.getEnvVar("NV_MONGO_URI");
const db  = svcEnv.getEnvVar("NV_MONGO_DB");
const col = svcEnv.getEnvVar("NV_MONGO_COLLECTION");
```

## Alternatives Considered
- Keep DTO‑specific getters (e.g., `mongoUrl()`): rejected as it re‑couples adapters to DTO internals.
- Accept defaults in adapters: rejected (violates “no silent fallbacks”, Dev == Prod).

## References
- SOP: NowVibin Backend — Core SOP (Reduced, Clean)
- ADR‑0039 — svcenv centralized non‑secret env
- ADR‑0040 — DTO‑Only persistence via managers
- ADR‑0041 — Controller & Handler Architecture
- ADR‑0042 — HandlerContext bus
- ADR‑0043 — DTO hydration & failure propagation
