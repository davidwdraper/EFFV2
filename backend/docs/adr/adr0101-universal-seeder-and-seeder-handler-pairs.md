adr0101-universal-seeder-and-seeder-handler-pairs

## Context

NV pipelines are moving from `index.ts` “instantiate handlers in order” to manifest/plan-driven pipelines (ADR-0100). This unlocks deterministic planning and strict handler-test discovery, but it also surfaced a real tension:

- Handlers should be tested in the environment they execute (same controller/runtime wiring).
- Handlers should **not** be tested with hidden upstream dependencies (standalone tests).
- Orchestration steps that “just seed ctx” can still fail (missing keys, wrong source, wrong precedence).
- If seeding is implemented as bespoke helper/seed classes per pipeline, pipeline folders will bloat and become chaotic over time.
- NV also wants “LEGO handlers” with template-based tests: for most handlers, no custom test code should be required, and no test files should live inside the pipeline folder.

We need a design that:

- keeps pipeline folders light,
- preserves test realism,
- preserves test determinism,
- prevents “which step seeded this?” ambiguity,
- supports future unknowns without forcing bespoke per-pipeline seeder files.

## Decision

### 1) Replace “helpers” with “seeders”

We drop the term “helper” entirely. The term implies optional logic and invites drift.

**Seeders** are orchestration steps whose only job is to prepare live-shaped inputs for the handler that follows.

Seeder contract (locked):

- Seeders may read from `HandlerContext` and `SvcRuntime` (and controller accessors).
- Seeders may write to `HandlerContext` via `ctx.set(...)`.
- Seeders may fail-fast if required prerequisites are missing.
- Seeders must NOT perform I/O (no DB, no S2S, no filesystem, no crypto).
- Seeders must NOT mutate domain payloads (bags/DTOs). Any payload mutation is a real handler step.

### 2) Pipelines are expressed as seeder→handler pairs

Every handler step in a pipeline is paired with a seeder step. The pair executes as **two independent steps**, but they are **glued at the hips**:

- Step A: `seeder`
- Step B: `handler`

This pairing exists even when seeding is unnecessary.

### 3) Default to a single universal seeder, but allow replacement

To keep pipeline folders light and avoid bespoke seeder sprawl:

- NV provides one universal default seeder (the “universal seeder”).
- The universal seeder accepts a declarative `seedSpec` consisting of simple mapping rules (source → destination, required, etc.).
- A pipeline may override the seeder for a specific handler **only when necessary** (future-proof escape hatch), but this must be rare and justified.

### 4) Universal seeder is the default; Noop seeding is explicit

Every handler has a seeder step. When a handler requires no seeding, the seeder is a **Noop seedSpec** (or an explicit noop rule set), not a bespoke file/class.

### 5) Test-runner executes seeder→handler pairs

The test-runner iterates over pipeline pairs and executes:

1. the seeder (universal or overridden), then
2. the handler

The handler test record continues to be the canonical result artifact. Seeders are orchestration rails and do not require separate Mongo records.

### 6) Handler test sidecars seed the seeder’s prerequisites (not the handler’s inputs directly)

A handler’s test sidecar is responsible for:

- ensuring the seeder has what it needs (ctx keys, runtime values, etc.)
- then allowing the seeder to prepare the live-shaped inputs for the handler
- then running the handler and asserting outcomes

This preserves:

- realism (seeders run exactly as they do in execution), and
- determinism (each handler’s test explicitly defines the seeder prerequisites).

### 7) LEGO handler tests are template-driven, not bespoke per pipeline

For LEGO handlers (standard shapes like `code.*`, `db.*`, `s2s.*`, etc.), tests should be provided by templates / shared harness patterns so that:

- no custom test code is required in most cases, and
- pipeline folders do not accumulate test sidecar noise.

### 8) Pipeline step readability: one function per seeder+handler pair

To keep large pipelines skimmable as NV scales to hundreds of pipelines:

- Each seeder+handler pair MUST be defined in a dedicated, named function inside the pipeline module:
  - Example: `codeMintUuid()`, `codeExtractPassword()`, `s2sUserCreate()`, `s2sRollbackOnFailure()`.
- `buildPlan()` MUST return a list of these function calls:
  - `return [ codeMintUuid(), codeExtractPassword(), s2sUserCreate(), ... ];`
- The step function is the canonical place for human-readable comments about:
  - what the step does,
  - what it seeds,
  - what the handler consumes/produces.

This yields “table-of-contents” readability without breaking the “planning is pure” invariant.

## Consequences

### Positive

- Pipeline folders remain light: no proliferation of bespoke seeders and bespoke tests.
- Eliminates ambiguity: for any handler, there is exactly one preceding seeder step responsible for its live inputs.
- Tests catch seeding failures: missing prerequisites or incorrect sourcing are exercised via the seeder in the test-runner.
- Handlers remain source-agnostic: they require keys but never encode where the keys came from.
- Future-proof: pipelines can override the universal seeder when an unforeseen case cannot be represented declaratively.
- Supports the “LEGO handler” goal: standardized handler shapes can have standardized test templates without per-pipeline files.
- Pipelines remain readable at scale via “one function per step” structure.

### Tradeoffs

- Slightly more orchestration surface (every handler has a paired seeder step).
- Some redundancy is intentional (if two handlers need the same seeded value, seeding may happen twice).
- Requires discipline: seeders must not accrete I/O or payload mutation.

## Implementation Notes

### A) Plan shape

Pipeline plans must return paired steps (conceptual fields):

- `handlerName`, `handlerCtor`
- `seedName` (usually `seed.<handlerName>`)
- `seedSpec` (declarative rules)
- `seederCtor` (optional override; default is universal seeder)

Planning remains pure (ADR-0100): ctor references + data only.

### B) Universal seeder (default)

- Applies an ordered list of seed rules.
- Reads only from allowed sources (ctx/runtime).
- Writes only to ctx.
- Fail-fast on required values missing.
- No fallbacks; no guessing.

### C) Overrides

- Pipeline may set `seederCtor` to a custom seeder.
- Custom seeders must obey the seeder contract (no I/O, no payload mutation).
- Override usage should be logged/visible to discourage casual drift.

### D) Tests

- Handler sidecars seed the prerequisites for the seeder and then allow the runner to execute the seeder→handler pair.
- LEGO handler tests use template-based harnesses so that most handlers require no bespoke test code and no new files inside pipeline folders.

### E) Internal documentation template (locked) for handlers and seeders

Because “seeding” is now a first-class part of the execution environment, NV requires a strict internal doc/comment standard that is consistent across services and scalable.

#### E1) Handler IO Contract comment block (required in every handler file)

Each handler MUST contain an explicit IO contract block documenting **ctx inputs** and **ctx outputs**. Context must be explained plainly (not glossed over).

Template:

- `Handler IO Contract (ctx)`
  - Inputs (required unless noted):
    - `ctx["<key>"] : <type/shape>`
      - Source: `controller` | `seed.<handlerName>` | prior handler step
      - Meaning: what this value represents (domain context)
      - Valid values: constraints / examples / “may be empty”
      - Failure: what the handler does if missing/invalid (status/title)
  - Outputs (this handler writes):
    - `ctx["<key>"] : <type/shape>`
      - Meaning: what downstream expects this value to represent
      - When written: always | success-only | error-only
  - Error contract reminder:
    - On failure: must set `ctx["handlerStatus"]="error"` and `ctx["response.status"]` + `ctx["response.body"]` (or `ctx["error"]`).
    - On success: must not set error keys; if edge requires a bag, success must land in `ctx["bag"]`.

#### E2) Seeder mapping comment lines (required per mapping rule, at the pipeline step function)

Because the universal seeder is shared and generic, the _domain meaning_ of each mapping must live beside the `seedSpec`.

Rule:

- Each mapping rule in a step’s `seedSpec.rules[]` MUST be preceded by a single-line comment of the form:

`// <from> -> <to> : <why this mapping exists; domain meaning; handler input rationale>`

This comment is allowed to be reused for logging clarity, but its primary purpose is readability and correctness review.

Hard constraint:

- Seeder mapping rules MUST NOT mutate bags/DTO payloads. If the mapping intent is “edit bag contents,” that is a real `code.*` handler step, not seeding.

#### E3) Step function header comment (recommended)

With the “one function per step” design, the step function SHOULD have a small header comment summarizing:

- what the handler step does,
- what the seeder prepares (high-level),
- any critical invariants.

### F) Optional fail-fast input guard in HandlerBase (planned rail)

Seeding failures are not “logic,” but they are still failures that must be surfaced early and deterministically. NV will add an optional rail that can be enabled broadly:

#### F1) Level 1 (first): required ctx input keys

- Handlers may declare required keys via a method such as:
  - `protected requiredCtxKeys(): string[]`
- Base handler execution can fail-fast before `execute()` if any required key is absent.

#### F2) Level 2 (future): seeder→handler mapping verification

- When seeder specs and handler required keys are both available, the rails may verify that the seeder produced the handler’s declared required keys exactly.
- This is optional and should only be enabled after the pair model stabilizes, because it introduces additional coupling between pipeline plan metadata and handler declarations.

## Alternatives

1. **Skip seeders in tests and seed directly in sidecars**

- Rejected: hides seeding bugs and diverges from live-shaped execution.

2. **Execute all pipeline steps (including shared helpers) during handler tests**

- Rejected: reintroduces ambiguity (“which helper seeded this?”) and undermines standalone tests.

3. **Bespoke per-handler seeders**

- Rejected: pipeline folders bloat and seeders proliferate; violates the “light folders” goal.

4. **Move all seeding into handlers**

- Rejected: handlers become source-aware and orchestration leaks into domain logic; harms modularity.

## References

- ADR-0100 (Pipeline plans + manifest-driven handler tests)
- ADR-0099 (Strict missing-test semantics; “skipped” must be explicit)
- ADR-0098 (Domain-named pipelines with PL suffix)
- SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
