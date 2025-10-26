adr0043-dto-hydration-and-context-failure-propagation
# ADR-0043 — DTO Hydration on Create & Context-Driven Failure Propagation

**Date:** 2025-10-26

## Context

We are beginning the `xxx.create.controller.ts` path for the template `t_entity_crud` service, governed by:
- ADR-0040 — DTO-Only Persistence via Managers
- ADR-0041 — Controller & Handler Architecture
- ADR-0042 — HandlerContext Bus (KISS)

Key constraints affirmed in discussion:

1. The DTO created for a request has **lifetime only within the controller invocation**. It is **not** persisted or cached by the controller; it exists to feed downstream handlers in the same chain.
2. `ControllerBase` **must** seed the **HandlerContext** with `body` (and standard metadata). If this is not currently true, it **must be added**.
3. `XxxDto.fromJson(input, opts)` must honor `opts.validate === true` to run Zod validation (ingress boundary rule from ADR‑0040). If the flag is present and true, validation executes.
4. **Failure propagation is context-driven:** If any handler fails, it places a **status** and **message suitable for Ops** into the `HandlerContext`. Every subsequent handler **must no-op passthrough** (read, detect failure, and forward the same context) until the chain completes and control returns to the controller.

## Decision

### Controller
- `xxx.create.controller.ts` contains **no business logic**. It simply orchestrates the handler chain.
- The controller constructs the chain and calls `ControllerBase.handle(req, res, handlers)` which internally:
  - creates a new `HandlerContext` (per-request),
  - seeds `requestId`, `headers`, `params`, `query`, and **`body`**,
  - runs handlers sequentially,
  - and finalizes the HTTP response using the context (see Output below).

### First Handler (`dtoFromJson.create.handler.ts`)
- **Single responsibility:** hydrate and validate the DTO from the request payload.
- Reads: `const body = ctx.get("body")`.
- Executes: `const dto = XxxDto.fromJson(body, {{ validate: true }})`.
- On success: `ctx.set("dto", dto)` and continue.
- On failure: catches `DtoValidationError` (or any error), sets:
  - `ctx.set("status", 400)` (or mapped status by error type),
  - `ctx.set("error", {{ code: "DTO_VALIDATION", message, issues? }})` with Ops guidance,
  then returns without throwing.

### Failure Propagation (Chain Discipline)
- **Any** handler that sees `ctx.get("status")` (truthy / >= 400) **must not perform its work**. It simply returns the same context (no-op passthrough). This ensures deterministic, side-effect-free behavior after first failure.

### Output (Controller Finalization)
- If `ctx.get("status")` is present: controller responds with that status and a Problem+JSON derived from `ctx.get("error")` (already Ops-friendly per DTO error construction).
- If no failure and no persistence yet: controller may respond with `200` and a smoke-friendly body `{{ ok: true, dto: ctx.get("dto")?.toJson() }}` (temporary during bootstrap). When WAL/DB handlers land, we will return an `ok` with ID/projection.

## Consequences

**Benefits**
- Strict separation of concerns (ADR‑0041): controller orchestrates; handler hydrates/validates.
- Consistent request-scoped state sharing (ADR‑0042). 
- DTO is the canonical authority; Zod validation controlled via `validate` flag (ADR‑0040). 
- Error handling is uniform and Ops-oriented; downstream handlers become safe no-ops after first failure.

**Trade-offs**
- Slight increase in boilerplate (explicit status/error checks per handler).
- Requires discipline to ensure **every** handler short-circuits on failure.

## Implementation Notes

- **Context Keys**
  - Input: `"body"` (seeded by `ControllerBase`)
  - DTO: `"dto"`
  - Failure: `"status"` (number), `"error"` (object with `code`, `message`, optional `issues`)

- **DTO API Standardization**
  - `static fromJson(json: unknown, opts?: {{ validate?: boolean }}): XxxDto`
  - `validate` defaults to `true` at ingress; may be set to `false` for WAL/DB rehydration per ADR‑0040.

- **Handler Template**
  ```ts
  export async function dtoFromJsonCreateHandler(ctx: HandlerContext): Promise<void> {{
    if (ctx.get<number>("status")) return; // short-circuit on prior failure
    try {{
      const body = ctx.get<unknown>("body");
      const dto = XxxDto.fromJson(body, {{ validate: true }});
      ctx.set("dto", dto);
    }} catch (err) {{
      // Map to Ops-friendly error in context; controller will render Problem+JSON
      ctx.set("status", 400);
      ctx.set("error", toDtoProblem(err)); // shared mapper: includes issues, guidance
    }}
  }}
  ```

- **Controller Finalization Pseudocode**
  ```ts
  const status = ctx.get<number>("status");
  if (status) {{
    return res.status(status).json(problemFromContext(ctx));
  }}
  return res.status(200).json({{ ok: true, dto: ctx.get<XxxDto>("dto")?.toJson() }});
  ```

- **Tests**
  - Unit: handler hydrates valid payload → `ctx.get("dto")` is `XxxDto` and no `status` present.
  - Unit: invalid payload → `ctx.get("status") === 400`, `ctx.get("error")` includes issues.
  - Integration (smoke): PUT create with valid/invalid bodies.

## Alternatives Considered

1. Throwing errors from handlers and catching at controller.  
   - Rejected: hides side-effect order, complicates “no-op after failure” rule.
2. Having controllers inspect DTO internals.  
   - Rejected: violates ADR‑0041 and DTO encapsulation.
3. Global mutable singletons for request state.  
   - Rejected: breaks request isolation and testability.

## References

- ADR‑0040 — DTO‑Only Persistence via Managers  
- ADR‑0041 — Controller & Handler Architecture  
- ADR‑0042 — HandlerContext Bus (KISS)  
- SOP — NowVibin Backend — Core SOP (Reduced, Clean)

## Status

Accepted — handler chain to begin with `dtoFromJson.create.handler.ts`.

---

## Amendment (2025-10-26) — HandlerBase (Shared) with DI & No-Go Short-Circuit

### Decision

Introduce a shared **`HandlerBase`** class (in `@nv/shared`) that receives the **`HandlerContext`** via **DI** and enforces short-circuit behavior across all handlers.

### Rationale

- Ensures every handler honors the **no-op after failure** rule without repeating boilerplate checks.
- Centralizes instrumentation (entry/exit logs, timing, requestId correlation).
- Keeps derived handlers **single-purpose** and tiny.

### Location

```
backend/services/shared/src/http/HandlerBase.ts
```

### API

```ts
export abstract class HandlerBase {
  protected readonly ctx: HandlerContext;

  constructor(ctx: HandlerContext) {
    this.ctx = ctx;
  }

  // Framework entrypoint called by controllers
  public async run(): Promise<void> {
    // Global short-circuit: if a prior handler set a failure status, do nothing.
    const status = this.ctx.get<number>("status");
    if (status && status >= 400) return;

    // Instrumentation hooks (optional in base)
    // onEnter()
    try {
      await this.execute(); // Derived handler's single concern
    } catch (err) {
      // Map error into context; let controller finalize Problem+JSON
      this.ctx.set("status", 400);
      this.ctx.set("error", toDtoProblem(err)); // shared mapper with Ops guidance
    } finally {
      // onExit()
    }
  }

  protected abstract execute(): Promise<void>;
}
```

> Controllers will instantiate each handler with the same `HandlerContext` instance (constructed in `ControllerBase`), e.g.:
> ```ts
> const ctx = controllerBase.makeContext(req); // seeded with body, params, query, headers, requestId
> const h1 = new DtoFromJsonCreateHandler(ctx);
> await h1.run();
> const h2 = new WalWriteCreateHandler(ctx);
> await h2.run();
> // ...
> ```

### Naming Alignment

First create handler remains:
```
controllers/xxx.create.controller/handlers/dtoFromJson.create.handler.ts
```

It will extend `HandlerBase` and implement `execute()`:
```ts
class DtoFromJsonCreateHandler extends HandlerBase {
  protected async execute(): Promise<void> {
    const body = this.ctx.get<unknown>("body");
    const dto = XxxDto.fromJson(body, { validate: true });
    this.ctx.set("dto", dto);
  }
}
```

### DTO Placement

`XxxDto` lives in **shared** because it represents data outside the edge boundary. Import path:
```
import { XxxDto } from "@nv/shared/dto/xxx.dto";
```

### Controller Finalization (unchanged)

- Controller inspects `ctx.get("status")` after the last handler to decide the HTTP response.
- Problem+JSON mapping occurs in controller (or centralized helper) using `ctx.get("error")`.

### Consequences

- **Benefits:** eliminates repeated guard code; consistent failure behavior; better instrumentation.
- **Trade-offs:** handlers now require construction via DI; minor ceremony in controller when creating chain.

---

## Amendment (2025-10-26) — Controller Finalization Contract

### Decision

Controllers must defer HTTP response construction to `ControllerBase.finalize(ctx)` and invoke it as the **last line** of the controller method:

```ts
return super.finalize(ctx);
```

### Behavior

`finalize(ctx)` determines the HTTP response strictly from `HandlerContext`:

1. **Failure present**: if `ctx.get("status") >= 400`, respond with that status and a Problem+JSON derived from `ctx.get("error")`.
2. **Build phase (single handler)**: if there is only one handler in the chain and it completed successfully (no failure status), `finalize` responds with **200 OK**. The default body during bootstrap may be `{{ "ok": true }}` (or `{{ "ok": true, "dto": … }}` when helpful for smoke).
3. **Later phases**: once additional handlers (WAL/DB/response-shaping) exist, `finalize` will render according to context keys set by those handlers (e.g., projection, IDs, etc.).

### Notes

- Controller methods remain orchestration-only: build handler array → run → `super.finalize(ctx)`.
- This unifies response semantics across all controllers and services.

---

## Amendment (2025-10-26) — Status Taxonomy & Finalize() Behavior

### Status Model (in `HandlerContext`)

Controllers and handlers communicate outcome via the following **conventional keys**:

- `handlerStatus`: `"ok"` | `"warn"` | `"error"` (string; default `"ok"` if absent)
- `status`: number (optional; HTTP status to emit when `"error"`; if missing on error, default is **500**)
- `error`: object (optional; **ErrorMsg** structure for Ops) — present on `"error"`
- `warnings`: array of objects (optional; list of **WarnMsg** items) — present on `"warn"`
- `result`: any (optional; response payload/projection set by later handlers)

### Message Shapes

```ts
type ErrorMsg = {
  code: string;                 // machine-friendly (e.g., "DTO_VALIDATION", "DB_TIMEOUT")
  message: string;              // human description for Ops
  hint?: string;                // actionable suggestion (triage steps)
  where?: {
    service?: string;
    component?: string;
    method?: string;
    file?: string;
  };
  issues?: Array<{ path: string; code: string; message: string }>; // e.g., Zod issues
};

type WarnMsg = {
  code: string;                 // e.g., "MISSING_OPTIONAL_FIELD"
  message: string;              // non-fatal data concern
  hint?: string;
};
```

### Handler Conventions

- On success: **do not** set `handlerStatus` (implicitly `"ok"`). Place outputs in context (e.g., `ctx.set("dto", dto)`).  
- On **warning** (data-related, non-fatal): set `handlerStatus="warn"` and push a `WarnMsg` into `warnings`. Do **not** set `status`.  
- On **error** (application failure or invalid input): set `handlerStatus="error"`, set `status` (4xx or 5xx), and attach an `ErrorMsg` in `error`.  
- After a handler sets `"error"`, subsequent handlers **must no-op** (short-circuit). `HandlerBase.run()` enforces this.

### `ControllerBase.finalize(ctx)` Rules

`finalize(ctx)` inspects context and decides the HTTP response; it does **not** care how many handlers ran.

1. **Error path** (`handlerStatus==="error"` OR `status>=400`):
   - Logs the `ErrorMsg` at **error** level with `requestId` and context snapshot (safe fields).
   - Responds with `status` (if present) else **500**. Body is Problem+JSON built from `error`.
2. **Warning path** (`handlerStatus==="warn"` AND no error):
   - Logs each `WarnMsg` at **warn** level with `requestId`.
   - Responds **200 OK** by default (unless a later handler set a different 2xx/3xx `status`), and may include `{ "ok": true, "warnings": [...] }` unless a `result` was provided.
3. **OK path** (no `handlerStatus` or explicitly `"ok"` and no `status`):
   - Responds **200 OK**. If `result` exists, return it; otherwise default to `{ "ok": true }` (or include DTO during bootstrap when useful).

### Logging

- `ControllerBase` logs:
  - entry/exit with `requestId`, route, timings;
  - warnings and errors per above;
  - optional `ctx.snapshot()` for deep triage (redact sensitive headers if enabled).

This codifies that **handlers decide semantics**, and `finalize()` **uniformly** maps the final `HandlerContext` to HTTP.
