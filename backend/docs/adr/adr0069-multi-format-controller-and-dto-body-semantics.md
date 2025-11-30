adr0069-multi-format-controller-and-dto-body-semantics
# ADR-0069 — Multi-Format Controllers & DTO Body Semantics (JSON, HTML, Streaming)

## Context

The NV backend is greenfield and fully under our control. No external clients yet exist, and no backward-compatibility obligations constrain architectural decisions. Controllers currently assume JSON wire formats, and DTOs use `toJson()` / `fromJson()` as their canonical IO surface. This naming binds DTOs to JSON semantics and obstructs the introduction of non-JSON response types — such as HTML console pages and future streaming responses.

Now that the Gateway can serve HTML directly, the architecture must support:

- JSON controllers (API workers)
- HTML controllers (admin / console pages)
- Future controllers (streaming, file, binary, etc.)

**Without** compromising the DTO-first rails, DtoBag invariants, or the greenfield purity of the backend.

The current finalize path is implemented entirely in `controllerFinalize.ts`, tied tightly to JSON and Problem+JSON semantics. Controllers cannot abstract finalize logic by output type, and DTOs cannot represent non-JSON bodies without architectural drift or escape hatches.

This ADR resolves these constraints definitively.

---

## Decision

### 1. `ControllerBase` now declares an `abstract finalize()` method  
All controllers must extend a concrete subtype that implements finalize semantics.

- `ControllerJsonBase` → JSON/Problem+JSON wire format  
- `ControllerHtmlBase` → HTML response format  
- Future: `ControllerStreamBase`, `ControllerFileBase`, etc.

No controller may extend `ControllerBase` directly.

---

### 2. JSON finalize logic is moved to `ControllerJsonBase`  
The old `controllerFinalize.ts` is decomposed and refactored into a JSON-specific finalizer.

- Bag-only success (`{ ok, items, meta, nextCursor }`)
- Error normalization (Problem+JSON + prompts)
- Duplicate key mapping
- All existing JSON semantics are preserved *intact*

This continues to enforce NV’s “bag-only edges” and canonical JSON protocol.

---

### 3. HTML finalize logic is implemented in `ControllerHtmlBase`  
The HTML finalizer:

- Reads `ctx["bag"]` (always a `DtoBag<HtmlDto>`)
- Calls `bag.toBody()` to extract HTML fragments or view-models
- Renders HTML via a shared layout (simple now, extensible later)
- Normalizes errors into Problem+JSON and renders a clean HTML error page

**Handlers never write raw HTML into ctx.**  
**DTOs own all representational truth.**

---

### 4. Global rename: `toJson()` → `toBody()`, `fromJson()` → `fromBody()`  
All DTOs adopt a representation-agnostic IO surface:

- `toBody()` returns the opaque wire body (JSON, HTML, or other)
- `fromBody()` hydrates a DTO from the wire body
- Persistence and pipelines treat “body” as opaque semantic truth  
  (DTO-first: no leaked shapes, no models, no schemas)

This rename is **global, immediate, and breaking**:

- DTOs  
- DtoBag  
- DbReader / DbWriter / DbDeleter  
- Handlers  
- Pipeline hydrators  
- SvcClient wire bag envelope construction  
- All smokes/tests

No aliases and no temporary backward-compatible methods.

---

### 5. HTML DTOs are first-class DTOs  
DTOs may now represent:

- JSON-ish persisted entities  
- HTML views (e.g., form panel, table, log list)  
- Rendering metadata (e.g., stylesheet, component key, layout hints)

All HTML controllers therefore remain DTO-first and bag-only.

---

## Consequences

### Positive

- **Multi-format response architecture** with no drift.  
- JSON and HTML controllers become cleanly separated.  
- DTOs fully own representational truth across all wire types.  
- Future streaming/file controllers fit naturally under the same pattern.  
- Eliminates all ad-hoc or accidental JSON assumptions from DTOs.  
- “Bag-only edges” remain universal.

### Negative / Costs

- The rename from `toJson`→`toBody` and `fromJson`→`fromBody` is **repo-wide and disruptive**.  
- All DTOs, handlers, repos, readers/writers, and tests must be updated simultaneously.  
- Some code (e.g., SvcClient) will require careful re-wiring of its envelope builder.  
- Smokes must be updated to call the new method names.  
- Documentation (SOP, LDD) must reflect the new semantics.

### Neutral

- HTML DTOs add flexibility but require discipline to avoid embedding too much view markup.  
- Rendering layout may grow more sophisticated later, but finalizers keep it centralized.

---

## Implementation Notes

1. **Remove controllerFinalize.ts entirely**  
   Its logic moves into `ControllerJsonBase`.

2. **Add new files**:
   - `ControllerJsonBase.ts`
   - `ControllerHtmlBase.ts`

3. **ControllerBase.ts**
   - Replace finalize implementation with `abstract finalize(ctx): Promise<void>`  
   - Ensure runtime helpers remain untouched.

4. **DTO changes**  
   - Replace `toJson` → `toBody`  
   - Replace `fromJson` → `fromBody`  
   - Update DtoBase and IDto accordingly.

5. **DtoBag**  
   - Replace internal calls to `dto.toJson()` → `dto.toBody()`  
   - Keep ordering/immutability rules.

6. **Persistence**  
   - Mongo adapters expect a “body” (formerly JSON) that must remain a plain JS object.  
   - HTML DTOs should *not* be persisted by DbWriter.

7. **HTML Finalizer Behavior**
   - Convert each DTO’s body into a section/widget/etc.  
   - Compose the final HTML document.
   - On error: Problem+JSON → HTML error page.

8. **SvcClient**  
   - All outbound S2S envelopes now contain `{ items: dto.toBody(), meta }`.

9. **Tests**
   - Update all smokes to reference `toBody`.

---

## Alternatives Considered

### A) Keep `toJson` / `fromJson` and add parallel HTML methods  
**Rejected.**  
Introduces type drift, violates DTO-first, increases API surface, and encourages dual semantics.

### B) Store HTML as raw `ctx["html.body"]` without HTML DTOs  
**Rejected.**  
Breaks bag-only edges, bypasses DTO invariants, encourages drift.

### C) Add conditional branching inside a single finalize function  
**Rejected.**  
Violates single-concern rule, produces brittle code paths, and blocks future wire formats.

### D) JSON-only backend with frontend rendering everything  
**Rejected.**  
Does not support the new gateway HTML console requirement.

---

## References

- ADR-0040 (DTO-Only Persistence; adapter edges)
- ADR-0041 (Controller & Handler Architecture)
- ADR-0042 (HandlerContext Bus)
- ADR-0043 (DTO Hydration & Failure Propagation)
- ADR-0044 (EnvServiceDto — Key/Value Contract)
- ADR-0049 (DTO Registry & Wire Discrimination)
- ADR-0050 (Wire Bag Envelope)
- ADR-0059 (dtoType & collection keys)
- ADR-0063 (UserCreate pipeline — bag purity)
- SOP (Reduced, Clean)
- LDD-00..34 (compression working set)
