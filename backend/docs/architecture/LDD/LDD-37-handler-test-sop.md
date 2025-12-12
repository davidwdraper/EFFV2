# LDD-37 — Handler Test SOP (Per-Handler Patterns)

## Goals

- Keep tests **small and focused**: a few scenarios per handler, not a test zoo.
- Every handler gets:
  - A **single, canonical happy-path scenario**.
  - A **small set of sad-path scenarios**, one per _meaningful_ guard.
- The test-runner will always run the **happy-path scenario first**. If it fails,
  subsequent sad-path scenarios for that handler are treated as **not meaningful**
  and may be skipped.

## Per-Handler Test Pattern

For each handler `foo.bar.ts`:

- Tests live side-by-side as `foo.bar.test.ts`.
- Each scenario is a class extending `HandlerTestBase`.
- Scenario ordering:
  - Scenario 1 (first class in file) is always **happy path**.
  - Additional classes in the same file are sad-path scenarios.

### Scenario 1 — Happy Path

- Uses **valid, realistic test data** for the handler.
- Asserts all key invariants for the handler:
  - Required ctx keys seeded/consumed.
  - Expected calls to downstream edges (SvcClient/DbWriter/etc.).
  - ctx mutations (e.g., status flags, bags, response fields).
  - `handlerStatus` ends as `"ok"` (or remains unset/OK).

If Scenario 1 fails, there is no value in continuing to test sad paths for that handler.

### Sad Paths — Guard-Level Scenarios

- Each **meaningful guard** in the handler gets at most **one** sad-path scenario:
  - Missing or invalid input on ctx (e.g. `ctx["bag"]` absent).
  - Missing rails (e.g. `getEnvLabel` / `getSvcClient` not available).
  - Downstream call failure (e.g. SvcClient error mapping).
- Sad-path scenarios assert:
  - Appropriate `handlerStatus="error"`.
  - Guard-specific flags/fields on ctx (e.g. `signup.userCreateStatus.ok === false`).
  - Problem+JSON semantics when applicable (status/title/detail/code).

### What Handler Tests Must **Not** Do

- Must **not** try to re-test shared helpers in depth (e.g., DbWriter internals).
  - Those have their own focused tests.
- Must **not** introduce logic that differs from the handler’s real code path.
- Must **not** branch on cluster-wide env concerns that belong elsewhere
  (e.g. DB_STATE/DB_MOCKING logic inside S2S handlers).
