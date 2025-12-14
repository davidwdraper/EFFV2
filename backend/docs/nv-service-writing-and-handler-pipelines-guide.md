# nv-service-writing-and-handler-pipelines-guide.md

## Purpose

This document is the **day-to-day guide** for building new NowVibin (NV) backend services once the shared rails are considered stable.

When we’re in full development mode, the **shared rails should be treated as “hands off.”** New service work should live almost entirely inside each service’s own folders:

- **Routes (routers)**
- **Controllers**
- **Pipeline `index.ts` (pipeline step ordering)**
- **Handlers**
- **Local helper modules/classes used by handlers**

If you feel the need to change shared rails to “make a service work,” that’s a smell. Prefer to fix the service code first; if a shared change is truly required, it should be rare, deliberate, and fully justified.

---

## Hard Prereqs for Any New Service

A service does not “exist” operationally until **both** of these are present and correct:

1) **env-service entry**
- The service must have an env-service record for its `(env, slug, version)` providing all required vars.
- Services must fail-fast on missing vars (**Dev == Prod behavior**).

2) **svcconfig entry**
- The service must have a svcconfig record that defines how it is reached (host/port/protocol), versioning, enablement flags, and routing eligibility.

If either record is missing or malformed, the service must **refuse to boot** (fail-fast).

---

## Service Surface: What You Build

### 1) Routes (Router files)
Routes are **one-liners**:
- They exist only to map HTTP paths → controller entrypoints.
- No business logic, no parsing, no “smart route” code.

### 2) Controllers
Controllers are **orchestrators only**:
- Seed `HandlerContext`
- Choose the pipeline
- Run the handlers
- Finalize response (success built from `ctx["bag"]`)

Controllers must not:
- Write to DB directly
- Perform S2S calls directly
- Contain “decision trees” that belong inside pipeline selection

### 3) Pipelines (folder + `index.ts`)
Each pipeline has an `index.ts` that defines:

- **Exactly which handlers run**
- **In exactly what order**

The order of execution is determined entirely by this `index.ts`.

### 4) Handlers
Handlers are the **unit of work**. Each handler should do **one thing** and do it well.

Handlers must:
- Read what they need from `HandlerContext`
- Perform one action (convert, compute, persist, call another service)
- Write their output back into `HandlerContext`
- Fail by setting `handlerStatus="error"`, plus `response.status` and `response.body` with **Ops guidance**

---

## Import Rules

- Service code may import shared modules using `@nv/shared/...`
- Files **within** `backend/services/shared/src/**` must use explicit relative imports (no `@nv/shared` alias)

---

## Handler Types (Filename Prefixes)

Handlers are categorized by filename prefix. Today there are four types:

### `toBag.*`
Handlers that obtain a JSON payload (usually from wire) and convert it into **bagged DTOs**.

- Example: `toBag.<dtoType>.<op>.ts`
- Typical output: `ctx["bag"] = DtoBag<SomeDto>`

### `code.*`
Handlers that do **data manipulation only**.

- No DB I/O
- No S2S calls
- Pure transformations, validation, shaping, computed fields, etc.

### `db.*`
Handlers responsible for CRUD operations on the database.

- `db.<dbName>.<collectionName>.create`
- `db.<dbName>.<collectionName>.readById`
- `db.<dbName>.<collectionName>.readList`
- `db.<dbName>.<collectionName>.update`
- `db.<dbName>.<collectionName>.deleteById`

> Keep `db.*` names explicit. The `<op>` token is required.

### `s2s.*`
Handlers (typically in MOS services) that make **S2S calls** to other services through the shared `SvcClient`.

- Example: `s2s.<service-name>.<endpoint>.ts`

---

## Service Type Guardrails (Illegal Combinations)

These are architectural rules, not suggestions:

### Entity services (DB-backed CRUD-style services)
- ✅ Allowed: `toBag.*`, `code.*`, `db.*`
- ❌ Forbidden: `s2s.*`

Entity services should not orchestrate other services. They own their data and their CRUD.

### MOS services (Micro-Orchestrator Services)
- ✅ Allowed: `toBag.*`, `code.*`, `s2s.*`
- ❌ Forbidden: `db.*`

A MOS coordinates work across services. It must not become a stealth DB-backed service.

---

## Shared “LEGO” Handlers (Prefer Reuse)

When one of the shared generic handlers fits, **use it**. Don’t rewrite it locally.

> If you’re about to write a handler and it looks like a shared LEGO handler, stop and reuse the shared one.

(Keep the canonical list in shared; this doc is intentionally “process-first,” not “inventory-first,” so it doesn’t rot.)

---

## Handler Class Naming Convention

Handler class names are derived from the handler filename:

1) Remove the dots  
2) Camel-case the remaining tokens  
3) Append `Handler`

Examples:

- `code.patch.ts` → `CodePatchHandler`
- `db.nv.users.readById.ts` → `DbNvUsersReadByIdHandler`
- `s2s.user.create.ts` → `S2sUserCreateHandler`
- `toBag.user.create.ts` → `ToBagUserCreateHandler`

Keep the filename prefix (`toBag`, `code`, `db`, `s2s`) aligned with the handler’s actual job.

---

## Output & Context Conventions

### Success path
- Pipelines must attach the success bag to **`ctx["bag"]`**
- Controllers finalize success responses strictly from `ctx["bag"]`
- Final handlers must store the success bag on `ctx["bag"]` (never `ctx["result"]` / `ctx["response.body"]` on success)

### “Bag baton” rule
To avoid key explosion while keeping traceability:

- `toBag.*` may set **both**:
  - `ctx["bagWire"]` (write-once snapshot of the inbound hydrated bag)
  - `ctx["bag"]` (the live baton bag that subsequent steps may replace)

Downstream handlers should treat:
- `ctx["bagWire"]` as immutable and for diagnostics only
- `ctx["bag"]` as the canonical “current bag” passed through the pipeline

This keeps `ctx["bag"]` canonical (finalize reads it) without encouraging `existingBag/priorBag/...` drift.

### Error path
Handlers must set:
- `ctx["handlerStatus"] = "error"`
- `ctx["response.status"] = <http code>`
- `ctx["response.body"] = { Problem+JSON-like object with Ops guidance }`

Ops guidance must be explicit. If something fails, the `detail` should give:
- what failed
- likely causes
- where to look (service logs, DB connectivity, env-service values, svcconfig mirror, etc.)

---

## Deprecation Note: “special output keys” (example: `existingBag`)

Avoid patterns that encourage multiplying special context keys:
- `existingBag`
- `priorBag`
- `originalBag`
- etc.

That becomes unmaintainable quickly.

### Preferred approach
- Keep `ctx["bag"]` as the baton
- If a stable snapshot is required, use the single reserved key `ctx["bagWire"]` (set once by the `toBag.*` handler)

If you need “read existing” behavior, do it by:
- reading from DB into a bag, then
- replacing `ctx["bag"]` (baton)
- and relying on `ctx["bagWire"]` if the pipeline must compare inbound vs existing

---

## Recommended Build Steps for a New Pipeline

### Step 1 — Decide service type
- Entity (DB-backed) vs MOS (S2S orchestrator)
- Lock the allowed handler types up front

### Step 2 — Define route(s)
- Versioned path shape: `/api/<slug>/v<major>/<dtoType>/<op>...`
- Health mounted before security/middleware

### Step 3 — Define controller entrypoints
- One controller per route concern
- Controller selects pipeline by `(dtoType, op)` or explicit route mapping

### Step 4 — Assemble pipeline `index.ts`
- Start with the smallest correct sequence
- Order handlers intentionally (no “it probably doesn’t matter”)

Typical pipeline ordering patterns:

**Create (entity service)**
1) `toBag.*` (wire → bagged DTO; also sets `bagWire`)  
2) `code.*` (validate/normalize/compute)  
3) `db.*.create` (persist)  
4) `code.*` (post-write shaping, warnings/meta)  
5) final: `ctx["bag"]` holds success bag  

**Read (entity service)**
1) `code.*` (build filter/query)  
2) `db.*.read*`  
3) `code.*` (pagination/cursor/meta)  
4) final: `ctx["bag"]`  

**MOS call flow**
1) `toBag.*`  
2) `code.*` (shape outbound request, assemble call params)  
3) `s2s.*` (call)  
4) `code.*` (normalize results into bag/meta)  
5) final: `ctx["bag"]`  

### Step 5 — Write any local helper modules
Helpers must:
- be local to the service unless clearly shared
- support handlers only
- avoid “framework drift”

### Step 6 — Add tests
At minimum, align with the “Safe Field Add” mindset:
- DTO round-trip (if DTO changed or introduced)
- Minimal controller or handler-level test for the new pipeline behavior

---

## Non-Negotiables (Aka “How to avoid future pain”)

- No duplicated shared handler logic in service pipelines when a shared LEGO handler fits.
- No mixed responsibilities inside a handler.
- No DB work in MOS services.
- No S2S orchestration in entity services.
- Pipelines own ordering; never hide ordering in “smart handlers.”
- Success responses come from `ctx["bag"]` only.
- Fail-fast on missing env-service/svcconfig prerequisites.

---

## Closing Reminder

Once the rails stabilize, speed comes from discipline:

- routers wire  
- controllers orchestrate  
- pipelines define order  
- handlers do one thing  
- shared LEGO handlers prevent copy/paste drift  

If we stick to that, “new service” becomes boring — and boring is exactly what you want in a backend.
