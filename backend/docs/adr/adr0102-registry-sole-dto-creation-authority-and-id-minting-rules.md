adr0102-registry-sole-dto-creation-authority-and-id-minting-rules

## Context

NV enforces a strict architectural rule:

If domain data leaves an internal module boundary, it must live in a DTO.

This implies:

- No raw JSON exists inside application rails (handlers, pipelines, services).
- All wire payloads and persistence records are converted into DTOs at the edge.
- DTO identity (\_id) must be deterministic, immutable, and never silently minted.

Historically, DTO creation and hydration occurred in multiple steps (for example:
Registry creates a DTO, then controllers call dto.fromBody()), which introduced
ambiguity around when \_id is minted, whether hydration may mint, and how DB reads
remain safe from silent identity generation.

This ADR formalizes a two-scenario, single-entry-point model that removes that
ambiguity entirely.

## Decision

The Registry is the sole authority for DTO creation.

DTOs must be created via the Registry. Controllers, handlers, and pipelines must
not instantiate DTOs directly.

The Registry exposes exactly one public entry point:

registry.create(dtoType, body?)

The presence or absence of body determines the instantiation semantics.

## Scenario A — Internal DTO Creation (No JSON)

registry.create(dtoType)

Behavior:

- Constructs a DTO with no JSON injection.
- The DTO constructor always mints a new UUIDv4 \_id.
- The \_id is immutable once set.

Use cases:

- Internal record synthesis (MOS handlers).
- Third-party ingestion results.
- Seeders and test data.
- Any new record created inside the application rails.

This is the only path by which internal code may create a new record DTO.

## Scenario B — Edge DTO Hydration (JSON Provided)

registry.create(dtoType, body)

Behavior:

- Constructs a DTO with JSON injection.
- The constructor does not mint an \_id.
- Hydration is performed immediately via internal fromBody(body) logic
  (either explicitly or as part of the constructor).
- fromBody enforces:
  - \_id exists in the payload.
  - \_id is a valid UUIDv4.
- Missing or invalid \_id causes a hard failure at the edge.

Use cases:

- Public API requests.
- S2S requests.
- DB read hydration (Mongo documents).
- Any boundary where data enters NV as a structured payload.

## Client-Side ID Requirement

All wire edge payloads (public or S2S) must supply an \_id.

To support clients that cannot generate UUIDv4 values:

- NV may provide a dedicated ID-minting endpoint.
- Clients must obtain an \_id from NV before issuing create requests.

As a result:

- DTO hydration from injected JSON never mints.
- Identity generation is explicit, observable, and deterministic.

## Controller and Application Rules

Controllers must not:

- Create a DTO and then call dto.fromBody() as a second step.

Controllers must:

- Call registry.create(dtoType, body) for wire requests.

Application code (handlers, pipelines) must not normally rely on fromBody().
Hydration via JSON injection is considered an edge concern.

fromBody remains available and is not technically forbidden, but:

- It is expected to be invoked only as part of Registry-managed JSON injection.
- Application code should not normally call it directly.

This preserves flexibility without encouraging misuse.

## Consequences

Positive:

- Exactly two DTO creation scenarios, no ambiguity.
- No flags, no runtime context, no ensureId parameters.
- No silent \_id minting during hydration.
- DB reads are safe by construction.
- Controllers become one-line DTO creators.
- Identity rules are structurally enforced, not convention-based.

Tradeoffs:

- Clients must understand UUIDv4 or use an NV-provided ID endpoint.
- Create flows become explicit rather than server-guessed.

These tradeoffs are accepted for correctness and determinism.

## Implementation Notes

- DTO constructors must distinguish between:
  - JSON-injected construction (no minting).
  - Non-injected construction (always mint \_id).
- The Registry must encapsulate this distinction fully.
- DbWriter and DbReader must never mint \_id.
- \_id remains immutable once set.

## Alternatives Considered

1. Minting \_id during hydration when missing.
   Rejected — leads to silent identity creation and DB corruption masking.

2. Runtime flags or context markers.
   Rejected — unenforceable and error-prone.

3. Multiple Registry creation methods.
   Rejected — unnecessary complexity for a binary model.

## References

- ADR-0057 (ID Generation & Validation — UUIDv4; immutable)
- ADR-0040 (DTO-Only Persistence)
- ADR-0047 (DtoBag semantics)
- ADR-0050 (Wire Bag Envelope)
