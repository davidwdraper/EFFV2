// docs/adr/adr0018-debug-log-origin-capture.md

# ADR-0018 — Debug Log Origin Capture (File, Class, Method, Line)

**Status:** Proposed — 2025-10-06  
**Owners:** Backend Core

## Context

Debug logs are most valuable when they clearly state **where** they were emitted from.  
Without source metadata (file/class/method/line), correlation across microservices during deep tracing becomes painful — especially after refactors.  
We already have contextual binding (`.bind(ctx)`), but we need **automatic origin capture** for debug-level logs.

## Decision

Enhance the shared `Logger` (ADR-0015) so that:

- For `debug()` calls, the logger inspects the current stack trace to determine:
  - file path (relative to repo root if possible)
  - class or function name
  - line and column number
- These values are appended to the structured context as:
  ```json
  {
    "origin": { "file": "...", "class": "...", "method": "...", "line": 123 }
  }
  ```
