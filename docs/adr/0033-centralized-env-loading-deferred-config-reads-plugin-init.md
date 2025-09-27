---
id: 0033
title: Centralized Env Loading + Deferred Config Reads & Plugin Init
date: 2025-09-26
status: Proposed
deciders: [David Draper]
tags: [env,  dotenv,  config,  bootstrap,  gateway,  plugins,  svcconfig,  audit,  ci]
---

# Status
Proposed

# Context
We operate a PNPM monorepo with multiple TypeScript microservices (gateway + workers). Historically, local runs relied on the shell runner (run.sh) to source repo-root .env.dev. A recent addition—route-access policy loaded from svcconfig—moved configuration reads to import time in the gateway, causing boot failures when starting the gateway alone (no env yet). We need a production-grade, audit-friendly approach that:
- Does not depend on the runner to preload env.
- Avoids import-time side-effects that require configuration.
- Provides deterministic env discovery across service-local and repo-root .env files.
- Works the same in dev, CI, Docker, and k8s.
- Produces clear, auditable validation of required configuration.

# Decision
Adopt a structured initialization model with deterministic environment discovery and deferred configuration reads:
1) Centralized Env Loader (shared)
   - Introduce @eff/shared/env/loadEnv.ts that merges env from service-local and repo-root .env files.
   - Discovery order (no override of already-set keys): service dir first, then continue upward to repo root to fill gaps.
   - Modes: dev/test/prod select .env.dev, .env.test, .env respectively. No automatic execution at import time.

2) Deferred Config Reads
   - Prohibit import-time requireEnv() across all services. Configuration is read and validated only inside a bootstrap phase.
   - Each service exposes readConfig() (pure) using a schema (e.g., Zod). The entrypoint calls: loadEnv(mode) → readConfig() → initPlugins(cfg) → startHttp(cfg).

3) Plugin Initialization Contract
   - Async subsystems (route-access policy, JWKS/KMS, caches) register types at import but do not perform I/O.
   - A uniform initPlugins(cfg) phase performs I/O after config validation.

4) Dev/Prod Guardrails
   - Route-access policy: ACCESS_RULES_ENABLED default=0 in dev/test, default=1 in prod. In prod, unavailable policy fails boot (fail-closed). In dev/test, allow observe-only or skip via ACCESS_FAIL_OPEN=1.
   - Health/readiness surfaces policyRevision and JWKS/ESK status for ops and smoke tests.

5) Runner-Independent Behavior
   - run.sh may export convenience vars (e.g., KMS_* aliases) but services must be self-sufficient. Env correctness never relies on the runner.

6) CI & Audit Hooks
   - Add scripts/validate-env.mjs to execute each service’s schema under dev and prod modes, printing an aggregated report of missing/invalid keys with secrets redacted.
   - Make this check part of CI to prevent drift and provide an auditable artifact.

# Consequences
Pros:
- Deterministic, documented env resolution; identical behavior across local, CI, Docker, and k8s.
- No import-time explosions; all configuration is validated during bootstrap with a single, readable error report.
- Clear plugin lifecycle (register → init), improving testability and startup observability.
- Dev/Prod guardrails enable fail-closed in prod while keeping developer velocity.

Tradeoffs:
- Slightly more boilerplate (bootstrap phases and initPlugins()).
- Requires refactoring modules that currently read env at import time.
- Two-level env discovery (service + repo root) must be well-documented to avoid confusion.

Operational Impacts:
- Health endpoints should expose policyRevision and JWKS/ESK health for smoke/ops.
- CI gains a dedicated config validation step; teams must maintain accurate schemas.
- run.sh becomes simpler and less critical to correctness.

Security & Audit:
- Centralized validation yields auditable evidence of configuration posture per environment.
- Fail-closed defaults in prod reduce accidental exposure during partial deployments.
- Secrets are never logged; validation output redacts values while naming missing keys.

# Alternatives Considered
1) Keep relying on the runner to source env — Rejected.
   Hidden coupling; breaks in Docker/k8s and single-service boots; not auditable.

2) Read env at import time — Rejected.
   Side-effects at import cause brittle startup and inconsistent behavior under different launchers.

3) Single .env file at repo root only — Rejected.
   Removes service-local overrides and complicates multi-environment workflows.

4) Per-hop KMS or policy-free dev bypass — Partially addressed elsewhere.
   Latency/security concerns are covered by ADR-0030/0032; this ADR focuses on structured initialization.

5) Use a third-party env framework (dotenv-flow, env-cmd) — Considered.
   Adds dependencies; our needs are simple and better served by a small shared loader with explicit order and schema validation.

# References
- SOP: docs/architecture/backend/SOP.md
- Logging & Audit SOP: docs/architecture/backend/LOGGING_AUDIT.md
- Health/Readiness ADRs: docs/adr/0016-standard-health-and-readiness-endpoints.md
- ADR-0030: gateway-only KMS signing and JWKS
- ADR-0032: Route Policy via svcconfig + CTX/HOP tokens
- svcconfig Overview: docs/architecture/backend/svcconfig/OVERVIEW.md
