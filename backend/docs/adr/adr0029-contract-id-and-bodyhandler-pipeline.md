adr0029-contract-id-and-bodyhandler-pipeline
# ADR-0029 — Contract-ID + BodyHandler Pipeline

## Context

NowVibin’s backend depends on a consistent, versioned **contract layer** for all service-to-service (S2S) communication.  
Every endpoint between microservices must be defined by a **shared Zod schema**—identical on both sides of the call—to ensure type safety, forward compatibility, and runtime validation.

In earlier iterations, request/response validation drifted because each service parsed payloads independently.  
This led to mismatched shapes, envelope confusion, and untraceable “unknown key” errors during smoke tests.  
To eliminate this drift, we introduced the **Contract-ID + BodyHandler pipeline**.

## Decision

### 1. Every shared contract has a unique immutable ID

Each contract subclass inherits from `ContractBase<TReq, TRes>` and declares:

```ts
public static readonly CONTRACT_ID = "service/entity.operation@v<major>";
```

- **Static, literal, and human-readable.**
- **Never derived dynamically** (e.g., from filenames or service names).  
- Used by both client (sender) and receiver to **assert runtime integrity**.

Example:

```ts
export class AuditEntryCreateContract extends ContractBase<AuditEntryCreateReq, AuditEntryCreateRes> {
  public static readonly CONTRACT_ID = "audit/entries.create@v1";
  public readonly request = AuditEntryCreateReq;
  public readonly response = AuditEntryCreateRes;
}
```

### 2. The Contract-ID is carried in the HTTP headers

Each S2S call includes a `x-contract-id` header.  
This header’s value must match the static `CONTRACT_ID` constant on both ends.

- The **SvcClient** (sender) injects the header.
- The **BodyHandler** (receiver) extracts and verifies it before decoding the request body.

Example header:

```
x-contract-id: facilitator/routePolicy.create@v1
```

### 3. The BodyHandler enforces schema + contract verification

Each service mounts a shared **BodyHandler** middleware before its routers.  
Responsibilities:

1. Read and validate `x-contract-id`.
2. Resolve the correct Zod schema (from the shared contract file).
3. Parse and validate the incoming body against `contract.request`.
4. Attach the parsed body to `req.validatedBody`.
5. Throw a structured 400 Problem if validation or ID mismatch occurs.

This guarantees both sides agree on the shape *and* version of every S2S message.

### 4. Sender/Receiver symmetry

| Role | Component | Responsibility |
|------|------------|----------------|
| Sender | `SvcClient` | Injects `x-contract-id`, wraps body in standard envelope, serializes JSON |
| Receiver | `BodyHandler` | Validates `x-contract-id`, decodes JSON, parses via Zod schema, attaches validated body |

This pattern eliminates shape drift entirely: all communication routes through a **single, versioned pipeline** governed by shared contracts.

### 5. Contract evolution policy

- Contract IDs are **immutable once published**.  
- Schema extensions are additive-only (optional fields) until a new major version.  
- Breaking changes (field rename, type change, required → optional, etc.) must use a **new contract ID with bumped major version**.

Example:
```
audit/entries.create@v1 → audit/entries.create@v2
```

### 6. Shared plumbing

- **ContractBase** defines `getContractId()` and `verify()` static helpers.
- **SvcClient** uses `contract.getContractId()` to emit headers.
- **BodyHandler** uses `ContractBase.verify(headerValue)` for validation.
- **RouterBase** ensures all responses are enveloped consistently `{ meta, data }`.

### 7. Fail-fast enforcement

- Missing or invalid contract ID → HTTP 400 Problem with code `contract_id_invalid`.
- Mismatched contract ID → HTTP 412 Problem with code `contract_id_mismatch`.
- Schema validation failure → HTTP 422 Problem with code `invalid_request_body`.

No request body is passed downstream until contract and schema are verified.

## Consequences

### Pros
- Zero schema drift: every S2S call validated against a shared contract.
- Easy debugging: `x-contract-id` identifies the exact expected shape.
- Backward-compatible evolution through versioned contract IDs.
- Prevents silent runtime failures from mismatched payloads.

### Cons
- Adds a small serialization/validation cost per S2S call.
- Requires discipline: no sidecar or quick-fix bypasses allowed.
- Every breaking schema change requires new contract versioning.

## Implementation Notes

- All contracts reside in `backend/services/shared/src/contracts`.
- Each file exports:
  - Zod request/response schemas
  - Concrete subclass of `ContractBase`
  - Static `CONTRACT_ID`
- `SvcClient` uses `contract.getContractId()` to set headers.
- `BodyHandler` uses `ContractBase.verify(receivedHeader)` for validation.
- `RouterBase` (v2) always uses enveloped responses `{ meta, data }`.

### Middleware order

1. Health check routes
2. VerifyS2S (JWT verification)
3. BodyHandler (Contract-ID + schema validation)
4. Routes

### Envelope policy

- Requests: **flat body** (no envelope)
- Responses: **standard envelope** with `{ meta, data }`

## Alternatives Considered

### A. Implicit schema versioning via code imports
Rejected — impossible to guarantee runtime integrity or cross-service compatibility.

### B. JSON schema registry service
Rejected — adds network complexity, requires additional runtime lookups.

### C. Manual schema validation per route
Rejected — invites drift, inconsistency, and error-prone maintenance.

## References

- ADR-0007 — SvcConfig Contract — fixed shapes & keys
- ADR-0020 — SvcConfig Mirror & Push Design
- ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
- SOP: NowVibin Backend — Core SOP (Reduced, Clean)
