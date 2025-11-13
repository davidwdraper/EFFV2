adr0058-handlerbase-getvar.md
# ADR-0058 — HandlerBase.getVar: Strict Per-Service Env Accessor

## Context
Prior to this change, handlers accessed Mongo and other service-level configuration variables through a mix of sources: context bus values, process environment variables, or ad hoc controller plumbing. This created ambiguity and made testing difficult, especially for bootstrapping services like `env-service` that manage configuration dynamically.

We needed a **strict, invariant way** for handlers to access their runtime environment variables—without any fallbacks, guesses, or silent degradation. This became especially critical during the development of the `env-service.clone` pipeline, where reads worked correctly but writes failed because Mongo configuration could not be located within the handler context.

## Decision
A new method `getVar(key: string): string | undefined` was introduced in `HandlerBase`. It provides a uniform, type-safe, and **strict** accessor for environment variables derived exclusively from `ControllerBase.getSvcEnv()._vars`.

### Implementation Details
- The method **does not** fallback to `ctx` or `process.env`.
- It emits a `WARN` log if:
  - `svcEnv` or `_vars` is missing.
  - The key is absent or empty in `_vars`.
- Returns `undefined` in those cases, allowing handlers to raise their own structured `MONGO_ENV_MISSING` or equivalent error.
- Logging context includes `slug`, `env`, `version`, and the list of available `_vars` keys for easy diagnostics.
- All new shared handlers (`bag.populate.query.handler.ts`, `bag.toDb.create.handler.ts`, etc.) now use `this.getVar("NV_MONGO_URI")` and `this.getVar("NV_MONGO_DB")`.

### Example Usage
```ts
const mongoUri = this.getVar("NV_MONGO_URI");
const mongoDb  = this.getVar("NV_MONGO_DB");
if (!mongoUri || !mongoDb) {
  this.fail(500, "MONGO_ENV_MISSING", "Missing NV_MONGO_URI or NV_MONGO_DB");
  return;
}
```

### Benefits
- **Consistency:** All handlers now share a single access pattern for service environment variables.
- **Auditability:** Every missing var is logged explicitly, with full context.
- **Testability:** No implicit coupling to process environment—unit tests can inject `svcEnv` fixtures.
- **Future-proof:** As additional configuration sources emerge (e.g., Vault, Redis), `getVar()` can remain the stable access point without code changes in handlers.

## Consequences
- Handlers must run within a controller that provides a valid `svcEnv` (usually from `AppBase` bootstrap).
- Unit tests for handlers now require minimal `svcEnv` scaffolding.
- Services that previously relied on `process.env` directly will need to be updated before integration.

## Implementation Notes
Located in:  
`backend/services/shared/src/http/HandlerBase.ts`

Instrumentation:  
- `getVar_no_vars` when `svcEnv` or `_vars` missing  
- `getVar_missing` when key absent or empty

Adopted in shared handlers:  
- `bag.populate.query.handler.ts`  
- `bag.toDb.create.handler.ts`

## Alternatives Considered
1. Continue passing `mongoUri` and `mongoDb` through `ctx` – rejected as brittle and redundant.
2. Read directly from `process.env` – rejected for violating fail-fast invariants and making boot order unpredictable.
3. Wrap `svcEnv` in a separate helper service – deferred; would be overengineering at this stage.

## References
- ADR-0040 (DTO-only persistence)
- ADR-0044 (EnvServiceDto — Key/Value Contract)
- ADR-0047 (DtoBag / DtoBagView)
- ADR-0050 (Wire Bag Envelope)
- ADR-0053 (Bag Purity)
