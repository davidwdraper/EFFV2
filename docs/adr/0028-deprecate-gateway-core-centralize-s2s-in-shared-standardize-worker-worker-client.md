---
id: 0028
title: Deprecate gateway-core; centralize S2S in shared; standardize worker→worker client
date: 2025-09-15
status: Accepted
deciders: [Platform Team]
tags: [security, s2s, jwt, architecture, shared]
---

# Status
Accepted

# Context
We previously used gateway-core as an internal S2S proxy that re-minted tokens and forwarded to workers. This added operational drift (duplicate token logic), an extra hop to debug/operate, and confusion over the trust boundary. The edge gateway is the only public entry point; all workers are internal. Consolidating token minting in @eff/shared removes drift, simplifies boot/debug, and ensures uniform verification across services.

# Decision
Retire gateway-core from the runtime path. Centralize S2S minting and user-assertion minting in @eff/shared:\n- @eff/shared/src/utils/s2s/mintS2S\n- @eff/shared/src/utils/s2s/mintUserAssertion\n- @eff/shared/src/utils/s2s/httpClient for worker→worker calls\nGateway imports the shared minters for Upstream Identity Injection. Workers use s2sRequest() for internal calls (only need target URL + optional body). verifyS2S policies updated so issuer/caller is 'gateway' only.

# Consequences
Single source of truth for S2S & user assertion tokens; fewer moving parts; uniform token shapes; simpler tests. Gateway-core references removed from code and tests. Risks: any missed import paths will fail at compile or boot; smoketests must exercise proxy, guardrails, WAL, and internal calls.

# Alternatives Considered
1) Keep gateway-core as a re-minting proxy (rejected: drift/complexity).\n2) Push S2S minting into each worker (rejected: fragmentation/dup logic).\n3) Use a third-party STS (overkill for current scale; adds latency, ops overhead).

# References
- SOP: docs/architecture/backend/SOP.md\n- docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md\n- docs/adr/0017-environment-loading-and-validation.md\n- docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
