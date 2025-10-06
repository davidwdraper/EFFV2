// docs/adr/adr0006-gateway-edge-logging.md

# ADR-0006 — Gateway Edge Logging (Pre-Audit, Toggleable)

**Status:** Accepted — 2025-10-06  
**Owners:** Backend Core

## Context

We want visibility into inbound edge requests before proxying or business logic, while keeping noise manageable and clearly separating security vs WAL (write-ahead/audit) concerns.

## Decision

Introduce **edge hit logging** middleware in Gateway that:

- Runs **before** proxy/middleware.
- Writes structured logs with request id, method, path, ip.
- Separates **SECURITY** (denials/guards) from **WAL/AUDIT** (accepted requests).
- Is toggleable via env flag.

## Consequences

- ✅ Early diagnostics on routing/proxy problems.
- ✅ Clear separation of security events vs general traffic.
- ⚠ Slight log volume increase; mitigated via toggle.

## Implementation Notes

- Mount immediately after health routes.
- Respect `EDGE_LOG_ENABLED` (bool).
- Include `x-request-id` correlation.

## Alternatives

- Only audit at service backends (loses edge perspective).
- Always-on verbose logging (too noisy).

## References

- ADR-0001, ADR-0003, ADR-0013
