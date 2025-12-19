# LDD-40 – Handler Test Design

## Purpose

Define a consistent, minimal, reusable mini‑framework for handler‑level tests in the NV backend, avoiding drift and test contamination.

---

## High‑Level Goals

- Every handler test runs in isolation.
- The test harness—not the production controller—creates HandlerContext.
- A fresh context per scenario eliminates context bleed.
- Base class constructor seeds generic ctx and test metadata.
- handler.runTest() delegates to a base harness template.
- DTO seeding is unified and overridable.
- Assertions for DTO bag and context values are standardized.

---

## Context Lifecycle

### For each scenario (per handler):

1. Construct HandlerTestBase instance → ctor:
   - new HandlerContext
   - seed generic ctx fields:
     - requestId (UUIDv4)
     - env/dbState/dbMocks/s2sMocks
     - created timestamp
2. Test harness calls seedDto(ctx):
   - mint concrete DTO using buildDefaultDto()
   - wrap in a DtoBag
   - stash bag on ctx under standard key(s)
3. Optional per‑scenario mutations
   - adjust fields for positive/negative cases
4. Construct handler bound to the test controller + ctx
5. Execute handler
6. Shared assertions
7. Return HandlerTestResult to StepIterator

---

## DTO Seeding Rules

- buildDefaultDto() provides valid, full DTO values
- Must call real DTO constructor + validation (DtoBase.fromJson + check())
- Never bypass validation — seeded DTOs must be prod‑valid
- seedDto() wraps DTO in DtoBag, sets bag in ctx
- Negative tests mutate default DTO post‑creation, before bagging

---

## Unique Test Value Helpers

Needed to avoid indexed field collisions in DB write tests. Provide helpers:

- nextUuid()
- nextEmail()
- nextPhoneE164()
- nextSlug()
- nextRandomString()

Helpers guarantee uniqueness across entire test run.

---

## DTO Bag Assertions

Reusable helpers:

- assertBagZero()
- assertBagOne()
- assertBagAtLeastOne()

Optional extensions (future):

- assertBagEvery(dtoCtor)
- assertBagFirst(dtoCtor)

All assertion errors must include:

- handler name
- scenario label
- expected vs actual bag size

---

## Context Assertions

Reusable helpers:

- assertCtxString(key)
- assertCtxNonEmptyString(key)
- assertCtxStringEquals(key, expected)
- assertCtxStringMatches(key, regex)
- assertCtxHasValue(key)
- assertCtxValueIsZero(key)
- assertCtxValueIsNotZero(key)
- assertCtxUUID(key) // verifies ctx[key] exists and matches UUIDv4

All must report handler/scenario fields in failure messages.

---

## StepIterator + runTest Contract

- StepIterator calls handler.hasTest()
  - if true → runTest()
- handler.runTest():
  - loads scenarios
  - for each scenario:
    - instantiate HandlerTestBase
    - execute handler and assertions
    - return result to test‑runner
- Happy path first; runner may short‑circuit on its failure

---

## Core Invariants

- No handler may read test harness internals
- HandlerBase.execute behavior unchanged
- Test rails rely on DB_MOCKS + S2S_MOCKS + DB_STATE
- seedDto() always builds canonical DTO through validation
- Unique value helpers prevent silent index collisions
- No global context reuse — fresh instance per scenario

---

## Future Work

- Optional typed assertion DSL
- Auto‑registered scenario cases via decorators
- Per‑handler test coverage reports

## Example test

// backend/services/some-service/src/controllers/.../db.create.foobar.test.ts
/\*\*

- Docs:
- - LDD-40 (Handler Test Design)
- - ADR-0073 (Handler-Level Test Execution)
- - ADR-0042 (HandlerContext Bus)
-
- Purpose:
- - Demonstrate LDD-40 handler-test pattern for a db.create handler.
    \*/

import { HandlerTestBase } from "@nv/shared/testing/HandlerTestBase";
import { DbCreateFooBarHandler } from "./db.create.foobar";
import { FooBarDto } from "@nv/shared/dto/FooBarDto";

class FooBarCreateHandlerTestBase extends HandlerTestBase<FooBarDto> {
constructor(scenarioLabel: string) {
// bag key can be whatever this pipeline expects
super(DbCreateFooBarHandler, FooBarDto, "foobar.bag", scenarioLabel);
}

protected buildDefaultDto(): FooBarDto {
// canonical DTO generation through real constructor + validators
return FooBarDto.fromJson({
name: this.nextRandomString("foobar-name-"),
email: this.nextEmail("foobar"),
phoneE164: this.nextPhoneE164("+1"),
}, { validate: true });
}
}

// happy path: correctly seeded DTO should produce one FooBar record in bag
export const scenario_happy_path = async () => {
const t = new FooBarCreateHandlerTestBase("creates foobar");

await t.executeHandler();

t.assertBagOne();
t.assertCtxNonEmptyString("db.foobar.\_id");
};

// negative path: no name (required) should fail validation inside handler
export const scenario_missing_name = async () => {
const t = new FooBarCreateHandlerTestBase("missing name");

t.mutateDto(dto => {
dto.name = ""; // violate contract
});

await t.executeHandler();

t.assertBagZero();
t.assertCtxStringEquals("error.code", "VALIDATION_ERROR");
};
