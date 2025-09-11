---
id: 0016
title: Standard health and readiness endpoints
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [operations, health, readiness, observability]
---

# Status
Accepted

# Context
Health endpoints varied across services (paths, payloads), breaking probes and automation. Some liveness checks touched dependencies and caused false negatives.

# Decision
Standardize a shared health router exposing /health, /health/live, /health/ready, /healthz, /readyz, /live, /ready. Liveness is local-only; readiness is fast and bounded with an optional checker. Include requestId in responses for correlation.

# Consequences
✅ Reliable probes; ✅ consistent payloads; ⚠️ teams must keep readiness light; ⚠️ deep checks belong elsewhere.

# Alternatives Considered
1) Per-service endpoints (drift). 2) Mesh-only health (opaque). 3) Single path only (tooling pain). Rejected.

# References
- Design: docs/design/backend/health/OVERVIEW.md\n- Code: backend/services/shared/health.ts
