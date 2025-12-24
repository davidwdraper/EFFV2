# adr0082-infra-service-health-boot-check

## Status
Accepted

## Context

NowVibin (NV) domain services assume the presence of a small set of
**infrastructure services** that must be available for correct operation,
including (but not limited to):

- env-service
- svcconfig
- log-service
- prompts

As NV moves toward:
- S2S-based logging,
- WAL-backed writers,
- and infra-mediated runtime configuration,

it becomes unsafe for a domain service to start unless its required
infrastructure dependencies are **reachable and healthy at boot**.

Historically, this dependency was implicit and enforced informally.
This led to ambiguity during startup races and insufficient guarantees
that failures would be observable by operations (especially during early
boot).

This ADR formalizes a **hard-fail, config-driven infra health check**
that runs during service boot and is shared by all domain services via
the `t_entity_crud` template.

## Decision

Introduce a shared boot-time component called **InfraHealthCheck** with
the following behavior:

1. **env-service is always checked first**
   - If env-service is unreachable or unhealthy, the service **must not start**.
   - No further infra checks are attempted.

2. After env-service is confirmed healthy:
   - Fetch the `service-root` configuration record from env-service.
   - Read a required config variable:
     - `INFRA_BOOT_SVCS`
   - This variable defines, by slug, the additional infra services that
     must be healthy before startup may proceed.

3. Each infra service listed in `INFRA_BOOT_SVCS`:
   - Is checked via a canonical health endpoint.
   - Is checked using the same SvcClient path the service will use at runtime.
   - Must respond healthy within a bounded retry window.
   - Any failure causes **immediate process termination**.

4. Infra dependencies are therefore:
   - **Configurable without code changes**
   - **Strictly enforced at boot**
   - **Visible to operations**

## Process.env Exception (Explicit and Limited)

InfraHealthCheck is allowed a **single, explicit exception** to the
"no process.env reads" rule:

- `process.env` may be read **only** to obtain:
  - the logical environment label (e.g., `NV_ENV`)
  - the service version

This exception exists solely to allow infra health checking to occur
*before* service-specific configuration is fully available.

No other process.env access is permitted.

## Health Check Mechanics

InfraHealthCheck includes a private helper:

- `checkHealth(slug: string): Promise<void>`

This helper:
- Performs the SvcClient call to the service’s health endpoint
- Applies a bounded retry strategy (small number of attempts with short sleeps)
- Logs failures with concrete ops guidance
- Throws on failure; success is silent

This helper is reused for:
- env-service
- all additional infra services listed in `INFRA_BOOT_SVCS`

## Failure Semantics (Hard Fail)

If any required infra service:
- is unreachable,
- fails its health check,
- or returns an invalid response,

the domain service:
- logs a startup failure using the real logger,
- emits ops-actionable diagnostics,
- exits the process with a non-zero code,
- **does not bind an HTTP port**.

There is no degraded or “buffer-and-hope” startup mode.

## Template Integration

InfraHealthCheck is wired into the `t_entity_crud` template so that:

- All domain services cloned from the template inherit this behavior
- Infra dependencies are enforced consistently
- No retrofitting is required when new services are added

## Consequences

### Positive
- Deterministic, observable startup behavior
- Clear separation between infra readiness and runtime logic
- Config-driven control of infra dependencies
- Early detection of infra outages or startup races
- Strong alignment with WAL-backed and S2S-first architecture

### Tradeoffs
- Slightly longer startup time due to bounded health checks
- Requires infra services to expose reliable health endpoints
- Misconfiguration of `INFRA_BOOT_SVCS` will prevent service startup

These tradeoffs are accepted in favor of correctness and operational safety.

## References

- ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
- ADR-0044 (EnvServiceDto — Key/Value Contract)
- ADR-0072 / ADR-0073 (Test-Runner and S2S architecture)
- NowVibin Backend — Core SOP (Reduced, Clean)
## Infra Service Opt-Out (AppBase.isInfraService)

InfraHealthCheck must **not** run for infrastructure services themselves, to avoid
boot recursion and deadlocks (e.g., svcconfig attempting to health-check svcconfig).

To avoid introducing additional environment variables or config switches, NV uses an
explicit code-level opt-out:

- `AppBase` provides a default method:

  - `isInfraService(): boolean` → returns `false`

- Each infra service overrides this method to return `true`.

Template/domain service entrypoints (e.g., `t_entity_crud`) must guard InfraHealthCheck
execution using this method:

- If `app.isInfraService()` is `true` → skip InfraHealthCheck
- If `false` → run InfraHealthCheck normally

This approach keeps infra classification explicit, stable, and reviewable in code,
while allowing the infra dependency list (`INFRA_BOOT_SVCS`) to remain purely
config-driven for domain services.

### Additional Safety (Self-Skip)

InfraHealthCheck should ignore (and warn about) any occurrence of the current service
slug in `INFRA_BOOT_SVCS` to prevent accidental self-check configuration.
