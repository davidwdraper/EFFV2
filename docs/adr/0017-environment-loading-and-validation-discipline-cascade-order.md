---
id: 0017
title: Environment loading and validation discipline (cascade order)
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [config, env, operations, reliability]
---

# Status
Accepted

# Context
New services frequently failed to start because env files existed only at repo root or the service-family folder, not the service root. Prior loaders searched a single location, leading to missing vars and drift.

# Decision
Adopt a cascading loader for services: load envs in this exact order (later overrides earlier) — (1) repo root, (2) service-family dir (e.g., backend/services), (3) service root. At each layer: try mode-specific file (.env.dev or .env.docker) first, then .env. In production .env files are optional; in dev/docker at least one file in the cascade must exist. Keep loud validation helpers (requireEnv/*) with no silent fallbacks.

# Consequences
✅ New services pick up shared defaults without duplication; ✅ deterministic precedence; ⚠️ teams must keep env layers tidy; ⚠️ misconfig fails fast by design.

# Alternatives Considered
1) Single-location loader (breaks new services). 2) Implicit fallbacks (surprises). 3) Per-service bespoke loaders (drift/duplication). Rejected.

# References
- Design: docs/design/backend/config/env-loading.md\n- Code: backend/services/shared/env.ts
