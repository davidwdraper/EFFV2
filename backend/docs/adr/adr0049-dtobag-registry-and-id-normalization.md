adr0049-dtobag-registry-and-id-normalization
# ADR-0049 — DtoBag as Edge Payload, DTO Registry, and ID Normalization

Date: 2025-11-02

## Context
Our services have drifted between single-DTO and multi-DTO responses, custom id fields (e.g., `xxxId`), and ad‑hoc instantiation of DTOs at the edges. We also have growing mixed-type payloads (e.g., widget meta + event details) and an existing batching/cursor mechanism that expects DtoBag semantics. The lack of a formal discriminator and registry makes mixed-type bags brittle and invites duplicate logic across services.

## Decision
1) **`DtoBag` is the sole wire contract at service edges.** Controllers always emit/accept a `DtoBag` (single or many).  
2) **`IDto` is the infrastructure contract**, implemented by all DTOs:
   - `getId(): string` — immutable string id (DB type is abstracted)
   - `getType(): string` — stable discriminator (e.g., `env-service`, `event`)
   - `getVersion(): number | string` (optional; used for optimistic concurrency)
   - `toJson(): Record<string, unknown>` — MUST include `id`, `type`, and (if present) `version`
   - `patch(dto: IDto): void` — updates via public setters only; never changes `id`
   - `dbCollectionName(): string` — returns the collection for this DTO’s persistence
   - `/* static */ fromJson(json, opts): IDto` — validates, **requires** `id: string`
3) **`DtoBase`** enforces immutability of `id` and funnels all field changes through getters/setters (DTO internals are private).
4) **`DtoRegistry`** maps `type → DTO class` and is the only construction path inside `DtoBag.fromJson()` and adapters.
5) **Normalization is adapter-only.** `DbReader` converts DB-native types → app types (e.g., `ObjectId`→string, `Date`→ISO) **before** `fromJson()`. `DbWriter` performs the inverse **after** DTO validation.
6) **One canonical id name**: `id`. All former `xxxId` names are removed.
7) **Batching/Cursors** continue to use `DtoBag.meta` (`cursor`, `page`, `limit`, `total`, `elapsedMs`, `requestId`). The existing scripts remain but must be refit to the `id`/`type` rules and the registry-based instantiation.

## Consequences
- Uniform payloads simplify controllers, tests, and clients.  
- Mixed-type bags are reliable via a mandatory discriminator and registry.  
- DB adapters own all coercion, eliminating cross-layer type leaks.  
- Global rename from `xxxId` → `id` requires template and smoke-test updates.

## Implementation Notes
- **Boot self-test**: scan `@nv/shared/dto/**` and assert registry coverage; log counts. Fail-fast on missing types.  
- **Error guidance**: thrown errors must state what failed, why, and how to fix (ops-friendly).  
- **Pagination caps**: hard server limit; clear error when exceeded.  
- **Sorting/filters**: when bags are mixed-type, the caller MUST specify `type` for sortable fields.

## Alternatives
- Keep per-endpoint shapes (single vs many) → increases branching and bugs.  
- Construct DTOs ad-hoc in controllers → recreates registry logic everywhere.

## References
- SOP (Reduced, Clean) — DTO-first & audit-ready invariants
- Prior batching/cursor smoke tests (010 et al.)

