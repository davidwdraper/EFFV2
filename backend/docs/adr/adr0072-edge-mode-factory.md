# adr0072-edge-mode-factory.md

# ADR-0072 — Edge Mode Factory (Root Env Switches)

## Context

NV services will eventually support three edge behaviors:
- Fully mocked edges (no DB/API/FS calls),
- DB-mocked edges (DB mocked, other edges real),
- Full production edges.

All behavior must be env-service backed, with no ad-hoc process.env reads and no runtime guessing.
Handlers and pipelines must remain unaware of edge selection. Tests must be able to swap helpers without handler code changes.

We need a centralized factory that reads three switches from the root env-service record and resolves an effective edge mode.

## Decision

Root env-service record (`slug = "service-root"`) exposes:
- NV_MOCK_GUARD_1: boolean string
- NV_MOCK_GUARD_2: boolean string
- NV_MOCK_MODE: "prod" | "full-mock" | "Db-mock"

Both guards must be true before any non-prod mode is eligible.
NV_MOCK_MODE indicates intended mode but only applies if both guards are true.
In this ADR, mocks are ignored and the system always resolves to production mode.

A shared factory module will:
1. Read/validate the three switches.
2. Normalize values.
3. Always return production mode for now.

## Consequences

- Single source of truth for mock configuration.
- Safe integration path while mock injectors are still being designed.
- Future ADRs will enable non-prod modes.

## Implementation Notes

New module: backend/services/shared/src/env/edgeModeFactory.ts

Defines:
- EdgeMode enum
- resolveEffectiveEdgeMode(rootSvcEnv)
- Strict parsing of flags
- Always returns EdgeMode.Prod for now

## References

- ADR-0039
- ADR-0044
- LDD-02
- LDD-13
