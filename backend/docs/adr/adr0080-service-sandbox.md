adr0080-service-sandbox

# ADR-0080: Service Sandbox (SvcSandbox) — Transport-Agnostic Service Runtime

## Status
WORK IN PROGRESS — Accepted (Iterative)

This ADR intentionally defines a *living* contract. It will evolve as implementation
and testing reveal sharper boundaries.

## Context

As the NowVibin (NV) backend matured, handler-level testing exposed a systemic flaw:

- Handlers implicitly depended on global process state (env vars, mocks, boot order).
- DB + S2S tests required fragile masking (flags, partial mocks, guesswork).
- Test-runner executions did not faithfully represent real service runtime conditions.
- Controllers and handlers had no single, authoritative source of service configuration.

This caused:
- Tests that passed without performing real DB writes or S2S calls.
- Configuration drift between runtime and tests.
- Increasing difficulty reasoning about where a value originated.

To resolve this, we introduce a **Service Sandbox** (`SvcSandbox`) that represents the
*entire service runtime environment*, fully decoupled from transport concerns.

## Decision

Introduce a **SvcSandbox** abstraction that:

1. Encapsulates the full service runtime:
   - identity
   - validated configuration
   - capabilities (DB, S2S, audit, logging, etc.)
2. Is **transport-agnostic**:
   - no HTTP / Express / request objects
   - no response building
3. Is created once per service instance (runtime) or per pipeline (test-runner).
4. Is injected into controllers, and then into handlers.
5. Is the **only** location where environment variables are read and validated.

In running code, the sandbox instance will be referenced as:

- `ssb`

for brevity and clarity inside handlers.

## Non-Goals

SvcSandbox explicitly does NOT:
- Know anything about HTTP, Express, headers, routes, or status codes.
- Build wire responses or envelopes.
- Contain per-request state (those belong in HandlerContext).

## High-Level Shape

SvcSandbox represents a **service runtime**, not a request.

### Identity
- `serviceSlug: string`
- `serviceVersion: number`
- `env: string`
- `dbState: string`

### Configuration
- Raw vars: `Record<string, string>`
- Typed config: validated, parsed values
- Mock flags (DB_MOCKS, S2S_MOCKS) validated once

### Capabilities
- `logger`
- `problem` (RFC7807 factory)
- `db` (facade)
- `s2s` (SvcClient)
- `audit`
- `metrics` (optional)
- `cache` (optional)

### Helpers / Rails
- `getVar(key)`
- `tryVar(key)`
- `getDbVar(key)`
- `assertHealthy()`
- `describe()` — safe diagnostics (no secrets)

### Lifecycle
- `init()` — boot, validate, connect
- `dispose()` — teardown

## Transport Boundary

The following boundary is locked:

- **SvcSandbox** = service-wide runtime, transport-free
- **HandlerContext** = request-scoped data, transport-adapted
- **Controllers** = translate transport → HandlerContext → handlers

Handlers may access:
- `ctx`
- `ssb`
- DTOs / `DtoBag`s

Handlers must never access:
- `process.env`
- Express `req/res`
- transport-specific constructs

## Test-Runner Implications

The test-runner:
- Builds a SvcSandbox targeting the *service under test*
- Scopes it to the pipeline being executed
- Executes handlers exactly as runtime would

This allows:
- Real DB + real S2S tests (when allowed by flags)
- Deterministic, faithful pipeline execution
- Elimination of test-only masking logic

## Special Cases

Two services diverge only in **sandbox construction**, not interface:

- `env-service`
- `svcconfig`

They use specialized sandbox builders but expose the same SvcSandbox contract to
controllers and handlers.

## Consequences

### Positive
- Single source of truth for service configuration
- Deterministic, faithful handler testing
- Strict separation of concerns
- No hidden globals
- Easier reasoning about failures

### Tradeoffs
- Slightly heavier boot logic
- Requires discipline: no shortcuts to globals
- Initial refactor cost

## Open Questions / To Be Refined

- Exact typing of `config` vs `vars`
- Index-building responsibilities in sandbox `init()`
- Cache lifecycle ownership
- Metrics surface area
- CLI / cron execution patterns

These are intentionally left flexible.

## References

- ADR-0044 (SvcEnvDto contract)
- ADR-0072 / ADR-0073 (Test-runner architecture)
- LDD-35 (Handler-level test-runner)
- NowVibin Backend — Core SOP (Reduced, Clean)
