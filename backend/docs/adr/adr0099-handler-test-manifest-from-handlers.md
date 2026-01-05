adr0099-handler-test-manifest-from-handlers

# Context

We need the test-runner to reliably discover and execute handler-level tests without depending solely on implicit filename conventions or brittle inference rules. Today, the test-runner primarily discovers “what to run” by walking pipelines/steps and then applying convention-based logic to locate tests. This becomes fragile as pipelines grow, handlers are reused across pipelines, and some handlers are intentionally untested or only tested indirectly.

Separately, **production must be able to load test modules using CommonJS `require()` from compiled outputs only**. We cannot rely on loading TypeScript (`*.ts`) at runtime.

We want a more explicit, deterministic list of tests associated with the steps that actually ran (or were discovered), so the test-runner can:
- produce a concrete manifest of test modules to execute,
- store consistent “handler-test entries” in Mongo,
- and avoid surprises when naming or folder structure evolves.

# Decision

1) **Add a handler-declared test module name hook**
- `HandlerBase` will expose:

  - `handlerTestName(): string`

- Default behavior (dist-first):
  - returns the handler module’s compiled filename (derived from `__filename`) with extension swapped to `.test.js`.

  Example:
  - handler module: `.../dist/http/handlers/code.mint.uuid.js`
  - default test module: `.../dist/http/handlers/code.mint.uuid.test.js`

- Override behavior:
  - Derived handlers may override `handlerTestName()` to:
    - return an alternate module path (still dist-first, still `.js`), or
    - return `"skipped"` to indicate **no direct test module should be executed** for this handler.

2) **Introduce a pipeline-level test manifest recorder**
- A `PipelineBase` (or equivalent pipeline root artifact) will own a per-run collection of discovered test module names (a “manifest”).
- The manifest is recorded **as steps are constructed**, not inferred later.
- The recorder will:
  - collect the values returned by `handlerTestName()`,
  - deduplicate entries,
  - ignore `"skipped"`.

3) **Record handler test names during handler construction**
- `HandlerBase` construction will call `handlerTestName()` once and forward it to the pipeline’s recorder, if present.
- This does not add a hard dependency on pipelines for all handlers:
  - if no recorder is present (e.g., non-pipeline usage), no manifest entry is recorded.
- The handler’s runtime behavior remains unchanged (this is *metadata discovery*, not execution).

4) **Test-runner uses the manifest as the source of truth**
- The test-runner’s StepIterator (or equivalent runner) will consume the pipeline manifest:
  - to decide what tests exist,
  - to log/store handler-test entries deterministically,
  - to require/execute the compiled `.test.js` modules.

# Consequences

## Positive
- Deterministic test discovery: the runner executes exactly the tests declared by the handlers it discovers.
- Reduced reliance on brittle inference from handler names or folder structure.
- Supports intentional “no direct test” handlers via `"skipped"`.
- Dist-first compliance: everything required at runtime is a compiled `.js` file.

## Negative / Tradeoffs
- Requires wiring a pipeline recorder path that is available during handler construction.
- Adds a small amount of “test metadata” responsibility to `HandlerBase` (but not business logic).
- If tests are not compiled to `dist` for a given environment, the runner must fail clearly (correct: missing compiled test module is a wiring/build error).

# Implementation Notes

## Default name calculation (dist-first)
- `handlerTestName()` default should:
  - take `__filename`,
  - remove the final extension (e.g., `.js`),
  - append `.test.js`.

This intentionally ties runtime loading to compiled artifacts.

## Skip contract
- If `handlerTestName()` returns `"skipped"`:
  - pipeline recorder does not store it,
  - test-runner does not attempt to load a test for that handler.

## Pipeline recorder access
Preferred:
- The pipeline runtime provides a recorder to handlers (via controller/pipeline runtime object) **without using ctx as a global app-plumbing dump**.

Acceptable minimal path:
- A pipeline seeds a recorder into `HandlerContext` under a single well-known key (e.g., `ctx["pipeline.testNames"]`) strictly for this metadata purpose.

## Dedupe + ordering
- Recorder should dedupe (Set) but preserve a stable order for repeatability (e.g., insertion order).

## Failure mode
- If a test name is present but the module cannot be required from dist:
  - test-runner should record a failed test entry with a clear “module not found” reason (this is a build/wiring failure, not a handler failure).

# Alternatives

1) **Convention-only discovery**
- Continue deriving test names from handler names and file layout.
- Rejected: brittle and increasingly error-prone as codebase scales.

2) **Registry-driven test mapping**
- Maintain a central registry mapping handler names → test modules.
- Rejected: encourages drift and duplicated maintenance burden.

3) **Source-first `.test.ts` execution**
- Load and execute TypeScript tests directly.
- Rejected: violates production constraint; prod must load dist-only.

# References

- NowVibin Backend — Core SOP (Reduced, Clean, Locked)
- ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
- ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
