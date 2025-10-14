# ADR-0026 — Gateway Audit WAL via app.ts Middleware (Pluggable Writers)

## Context
- We run a **pluggable** Audit WAL architecture (MockWriter, DbWriter proven; HttpWriter next).
- The old Gateway WAL sprinkled logging hooks across controllers/routers and leaked implementation details (harder to reason about, test, and replace).
- SOP requires **single-concern files**, **middleware-first wiring**, **audit flushed once per request**, and **Dev == Prod** with **no silent fallbacks**.
- We must **remove all remnants** of the old WAL to prevent drift, double-writes, and confusion.

## Decision
- Integrate Gateway audit logging exclusively through **`app.ts` middleware**:
  1) **Ingress audit-start** middleware attaches `req.audit` (opaque array) and logs a BEGIN envelope.
  2) Application logic pushes domain audit events to `req.audit[]`.
  3) A **single terminal middleware** (on response finish/error) builds the final audit envelope and **flushes once** through the **shared WAL facade**, which is **pluggable via WriterFactory**.
- Gateway adopts the shared WAL base (`Wal` + `WriterFactory`) identical to Audit Service, but with a **Gateway-specific writer selection via env**:
  - Phase 1 (this session): **`MockWriter`** only.
  - Phase 2: **`HttpWriter`** (uses `SvcClient` to POST to `audit@v1 /entries`).
- **No in-memory-only modes.** FS journaling is **mandatory** (Tier-1 LDJSON), with short-cadence fsync per ADR-0024.
- All configuration comes from env; **no hardcoded hostnames/ports**.

## Consequences
- **Pros**
  - Single chokepoint for auditing (clean, testable, no drift).
  - Pluggable writers allow production parity and incremental rollout.
  - Strict **once-per-request** flush reduces duplication and ordering bugs.
  - Cleaner controller code (thin controllers stay thin).
- **Cons**
  - Requires careful teardown of legacy code paths.
  - Slight upfront cost to introduce WriterFactory in Gateway and wire `SvcClient` for HttpWriter in Phase 2.

## Implementation Notes
- **Files impacted (Gateway)**:
  - `backend/services/gateway/src/app.ts` — mount `auditBegin`, core routes, then `auditFlush` terminal middleware; ensure **health routes mount first** and **verifyS2S** is after health.
  - **Remove** any old WAL files/usages under `gateway/src` (e.g., `wal/*`, ad-hoc `appendAudit*`, cursor files, replayers).
  - Ensure shared WAL types are imported from `@nv/shared/wal/*` (no barrels).
- **Env (example names; all required; fail-fast)**:
  - `NV_GATEWAY_WAL_DIR=/var/tmp/nv-gateway-wal` (or platform path)
  - `NV_WAL_FLUSH_MS=200` (example; tune as needed)
  - `NV_AUDIT_SERVICE_SLUG=audit`
  - `NV_AUDIT_SERVICE_VERSION=1`
  - `S2S_JWT_*` (issuer/audience/secret/allowed callers) as already standardized
- **Shutdown**: On SIGTERM/SIGINT, call `wal.flush()` and close journal handles before `process.exit(0)`.
- **Error path**: Global error sink must trigger `auditFlush` (don’t swallow). If flush throws, log `***ERROR***` and fail-fast (per SOP).

## Alternatives
- Keep legacy scattered hooks — **Rejected** (drift, duplication).
- Push auditing inside controllers only — **Rejected** (breaks “once-per-request flush,” violates thin-controller goal).
- Skip FS journaling in Gateway — **Rejected** (ADR-0024 durability guarantee).

## References
- ADR-0022 — Shared WAL & DB Base
- ADR-0024 — Audit WAL Persistence Guarantee
- ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
- SOP — NowVibin Backend (Reduced, Clean)
