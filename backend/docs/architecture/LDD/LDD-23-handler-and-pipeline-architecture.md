# LDD-23 — Handler & Pipeline Architecture

_(Per-Route Controllers, Multi-Op Controllers, HandlerContext Bus, Pipelines, and Execution Rules)_

---

## 1. Purpose

This chapter defines how NV services **actually do work** once an HTTP request lands:

- How per-route controllers orchestrate flows
- How **multi-op controllers** select pipelines dynamically
- How `HandlerContext` acts as a KISS key/value bus
- How handlers run in ordered pipelines
- How data and DTOs move through the pipeline
- How success, warnings, and errors are normalized
- How this ties into DTOs, DtoBags, DbReader/DbWriter, WAL, and Problem+JSON

If DTOs and contracts define _what_ the data looks like, the handler/pipeline architecture defines _how_ requests are processed top-to-bottom.

---

## 2. Core Principles

1. **Per-route controllers**  
   Each route mounts a controller class responsible for orchestration, never business logic.

2. **Handler pipelines**  
   Controllers delegate work to ordered lists of handlers, each performing exactly one concern.

3. **Multi-op controllers**  
   Certain routes support **multiple operations** (e.g., `read`, `mirror`, `list`, `s2s-route`) via an `:op` segment in the URL.  
   The controller inspects `ctx.get("op")` and selects the matching pipeline.

4. **HandlerContext as the bus**  
   All cross-handler communication is via a simple key/value store.

5. **Deterministic outcomes**  
   A request ends in:
   - `handlerStatus = "ok"`
   - `handlerStatus = "warn"`
   - `handlerStatus = "error"`

No “half-success” states.

---

## 3. Controller Role

A controller:

- Builds a `HandlerContext`
- Sets invariants (`dtoType`, `op`, `requestId`, etc.)
- Seeds registry constructors and hydrators
- Selects a pipeline
- Runs it
- Calls `finalize()` to emit a canonical HTTP response

### 3.1 Controller Anti-Responsibilities

Controllers **must not**:

- perform DB access
- mutate DTOs
- create ad-hoc responses
- call `res` directly (except via `finalize()`)

---

## 4. Multi-Op Controllers

Certain controllers (notably in CRUD-style services) support **multiple distinct GET operations** by interpreting an `:op` segment in the route:

Example route:
