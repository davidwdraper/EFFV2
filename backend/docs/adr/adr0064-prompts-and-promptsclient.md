adr0064-prompts-service-and-promptsclient
=========================================

# ADR-0064 — Prompts Service, PromptsClient, Missing-Prompt Semantics, Prompt-Flush MOS, and UI Rendering Text Catalog

## Status
Accepted

## Context

As more services produce user-facing or UI-facing output—especially error messages—we must prevent:

1. **Hard-coded text in handlers/controllers**
2. **Non-localizable messages**
3. **Drift across services**
4. **Inconsistent operator guidance**
5. **Breakage when text is missing or updated**

In addition, the NV frontend will be driven by **homegrown YAML-rendering logic** on the backend, and:

- The UI will be **multi-lingual for everything**, not just system messages.
- UI text (labels, headings, hints, descriptions, call-to-action strings, etc.) must be managed with the same rigor as error messages.
- YAML layout/config must never degenerate into a dumping ground for inline, language-specific copy.

The backend must deliver:

- Stable internal error codes and structured Problem+JSON for operators and automation.
- Centralized, versioned, and localizable **prompt text** for:
  - System messages (errors, warnings, help text),
  - UI labels and display text used by the YAML-driven rendering engine.

We also need:

- A **cache** so services don’t fetch the same prompt repeatedly.
- A way to **flush** that cache across the entire cluster when prompts change.
- A **logging mechanism** to highlight when prompts are missing without polluting WARN/ERROR channels.
- A path to **scale UI prompt usage** as the app grows to dozens of pages without unbounded in-memory cache growth.

This ADR establishes:

- A new CRUD worker service: **prompts**
- A new shared client: **PromptsClient**
- A new log level: **PROMPT**
- Required behavior when a prompt is missing
- A flush endpoint baked into every service via **AppBase**
- A miniature orchestrator service: **prompt-flush** to broadcast flush events through S2S
- A contract that **all YAML-based UI rendering** obtains human-readable text via PromptsClient rather than embedding hard-coded strings.

This is foundational to correctness, localization, performance, and long-term UI evolution.

---

## Decision

### 1. Introduce new CRUD worker service: `prompts`

- Clone of `t_entity_crud`.
- Slug: `prompts`
- Primary DTO: **PromptDto**
- Every prompt row represents **(promptKey, language, templateString)**.
- Unique index on: `(promptKey, language)`.

The prompts service is the **central text catalog** for:

- System-facing messages (e.g., error details, operator guidance),
- UI-facing messages (e.g., button labels, headings, tooltips, YAML-driven UI copy).

### PromptDto fields

| Field        | Type     | Notes |
|--------------|----------|-------|
| promptKey    | string   | canonical identifier used by handlers/controllers/YAML renderer |
| language     | string   | BCP-47 (`en`, `en-US`, `fr-CA`, …) |
| template     | string   | May contain `{param}` placeholders |
| description? | string   | Admin-only, not returned over wire |
| category?    | string   | Optional grouping (`system-error`, `system-warning`, `ui-label`, `ui-body`, etc.) |
| tags?        | string[] | Optional metadata (e.g., feature flags, ownership) |

### Template semantics

- `{name}` placeholder syntax.
- No logic, no conditionals.
- Pure string interpolation handled by **PromptsClient**, not by service logic.
- Same rules apply whether the template is used for:
  - Problem+JSON `detail`,
  - UI label/value in YAML-based rendering,
  - Any other human-readable copy.

---

### 2. Introduce `PromptsClient` in shared

- Lives in:  
  `backend/services/shared/src/prompts/PromptsClient.ts`
- Owned by every service’s `app.ts` (just like SvcEnvClient).
- Responsibilities:
  - Build/maintain a **cache** of templates keyed by `(lang, promptKey)`.
  - Retrieve raw template via SvcClient from the prompts service.
  - Interpolate using provided params.
  - Handle missing templates gracefully (see below).
  - Expose `flushAll()` to clear the cache.

### Cache rules (initial behavior)

- Cache stores **raw templates**, not rendered results.
- Negative caching is allowed:
  - If a prompt is missing, cache the absence to avoid log storms.
  - Negative cache entries reset via flush.

### Cache rules (future scaling behavior)

To support high-volume UI usage without unbounded memory growth:

- **Bulk fetch for cache misses (future refactor)**  
  - PromptsClient will eventually support **batch retrieval**:
    - When multiple keys are missing from the cache, PromptsClient may perform a **single bulk read** against the prompts service (or underlying DB) to retrieve all missing templates at once.
    - This keeps round-trips low when rendering complex YAML-defined pages where many prompts are required together.

- **Category-aware TTL for UI prompts (future refactor)**  
  - The `category` field may be used to assign different **TTL policies**:
    - Example:
      - `system-error` prompts: effectively no TTL (cached until flushed).
      - `ui-label` / `ui-body` prompts: TTL-based eviction for rarely used keys.
  - Cache entries gain:
    - A `lastAccessed` timestamp.
    - A per-category TTL.
  - When:
    - `now - lastAccessed > TTL(category)`, the entry becomes eligible for eviction.
  - **TTL reset on access**:
    - Each time a cache entry is accessed, its `lastAccessed` is updated, effectively implementing an LRU-style policy per category.
  - This keeps **hot** prompts resident while allowing old or rarely used UI prompts to age out.

These refinements are forward-looking and do **not** change the functional contract:

- Lookups still return either the localized text or the promptKey itself.
- PROMPT logging and flush semantics remain the same.

---

### 3. Missing prompt behavior

When `(promptKey, language)` is missing:

1. Log a structured entry at new log level **PROMPT**:
   - `promptKey`
   - `language`
   - `serviceSlug`
   - `requestId`
   - `meta` (e.g. originating internal error code or UI component ID)

2. **Return the promptKey itself as the string**.  
   - No interpolation attempt.
   - No sentinel wrapper or synthetic message.

3. Cache the “missing” status until next flush.

This ensures:

- App never breaks, including UI YAML rendering flows.
- Missing prompts are visible.
- Localization gaps are easy to detect in QA/ops.
- YAML-based UI surfaces clearly show “auth.password.too-weak” style text when configuration is incomplete, making issues obvious without crashing the renderer.

---

### 4. Introduce new log level: `PROMPT`

- Dedicated log channel for missing/bad prompt entries.
- Sits between INFO and WARN in seriousness, but isolated semantically.
- All missing prompt events log exactly once per `(lang, promptKey)` per boot, due to negative cache.
- Applicable both to:
  - System-error prompts (Problem+JSON),
  - UI prompts (YAML rendering).

---

### 5. Add prompt-flush endpoint to every service via AppBase

Each service receives an internal-only route:

```
POST /api/<slug>/v1/infra/promptFlush
```

Characteristics:

- Mounted by **AppBase**, not per service.
- S2S only (never exposed at gateway).
- Behavior: `appContext.promptsClient.flushAll()`.
- Returns `204 No Content` on success.

This endpoint gives **cluster-wide cache coordination**.

This flush semantics apply equally to:

- System messaging use of PromptsClient.
- YAML-driven UI rendering use of PromptsClient.
- Future bulk-fetch and TTL behavior (flush always resets everything).

---

### 6. Introduce `prompt-flush` MOS

A tiny orchestrator service:

- Slug: `prompt-flush`
- Single route:
  ```
  POST /api/prompt-flush/v1/infra/flush
  ```
- Behavior:
  1. Calls svcconfig `mirror` to retrieve all active services.
  2. Walks the DtoBag of svcconfig entries.
  3. For each service:
     - Sends `POST /api/<slug>/v1/infra/promptFlush` via SvcClient.
  4. Aggregates failures into a Problem+JSON response if needed.

This centralizes prompt cache invalidation across the fleet without adding a dedicated messaging system.

---

## Consequences

### Positive

- No hard-coded human-facing messages anywhere (system or UI).
- Localization-ready architecture for **all** user-facing copy:
  - Error messages,
  - UI labels and strings used in YAML-driven layouts.
- Strict, predictable error routing (internal codes vs human detail).
- YAML files stay focused on **structure and behavior**, not language-specific strings.
- Cluster-wide prompt updates take effect immediately after a single flush call.
- Missing prompts are **highly visible** without destabilizing services or UI rendering.
- No new logging service needed; `PROMPT` level handles visibility.
- Future-proof: bulk-fetch + category-based TTL avoids unbounded cache growth as the app grows.

### Negative / Tradeoffs

- Slight boot-time cost as caches warm.
- Negative caching means:
  - First miss logs once,
  - Subsequent uses silently return promptKey until flushed.
- Admin workflow for updating prompts must call prompt-flush MOS.
- Prompts are per-service cached, so long-running processes may show stale text until flush occurs.
- YAML rendering becomes dependent on PromptsClient availability; however, missing prompts do not break the app, they degrade gracefully.
- Future TTL/bulk-fetch logic adds complexity to PromptsClient internals, though the external contract remains simple.

None of these undermine correctness or production behavior.

---

## Implementation Notes

1. **PromptDto** lives entirely inside `prompts` service.  
   - Follow DTO-first rules; contract → DTO → handlers.

2. **PromptsClient** is instantiated in each service’s `app.ts` and stored on `appContext`.

3. **In finalize()** (Problem+JSON):  
   - Localized prompt lookup occurs here, not inside handlers.  
   - Handlers set:
     - `ctx["error.code"]` (internal)
     - `ctx["error.meta"]` (parameters)
   - finalize() chooses language (via header), fetches prompt, interpolates, and assigns `detail`.

4. **In YAML UI rendering**:  
   - YAML config contains prompt keys, not literal copy.
   - Renderer calls PromptsClient with (language, promptKey, params) to obtain text values.
   - Missing prompt → key returned as text, logged at PROMPT level.

5. **Routing rules**:  
   - prompts service uses normal CRUD paths (`create`, `read`, `update`, `list`).
   - prompt-flush uses single infra route.

6. **Security**:  
   - All flush paths S2S-only.
   - prompts service will eventually be behind verifyS2S.

7. **Testing**:  
   - Unit tests for PromptsClient interpolation, negative caching, flush behavior, and (when implemented) bulk-fetch and TTL policies.
   - Integration tests verifying that prompt-flush MOS hits every service and promptsClient cache is cleared.
   - Integration tests for YAML-based UI rendering:
     - Valid prompt keys,
     - Missing prompt keys (key returned, PROMPT log written),
     - Behavior before and after flush,
     - (Future) TTL expiry and refill behavior.

---

## Alternatives Considered

### A. Hard-coded strings in each service or YAML
Rejected — violates DTO-first, greenfield principles, and blocks localization. YAML is for layout/config, not for language-specific copy.

### B. Push-based message bus for prompt updates
Rejected — overkill; MOS + flush route keeps design simple and explicit.

### C. Store prompts in env-service
Rejected — prompts are not configuration; they are content.

---

## References

- SOP: DTO-first, no hard-coded strings, greenfield-only.
- LDD-06: Controller + pipeline architecture.
- LDD-11/17/18/29: Error semantics, logging, operator guidance.
- LDD-16/26: svcconfig routing + mirror semantics.
- LDD-00/01: CRUD rails + platform overview.
- YAML UI Rendering LDD (when finalized): This ADR is the text source-of-truth for all human-readable strings referenced by the rendering engine.
