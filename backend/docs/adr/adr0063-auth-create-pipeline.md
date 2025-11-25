# adr0063-auth-create-pipeline
## Context
The Auth service must orchestrate the creation of a new user across two distinct persistence domains:
1. **UserAuth record** (encrypted password + salt + foreign key userId)
2. **User profile record** (UserDto in user service)

Auth receives a **heterogeneous inbound DtoBag** containing:
- `UserCreateDto` — profile fields for the new user
- `UserAuthDto` — cleartext password

The pipeline must:
- Validate password strength
- Generate salt + encrypted password
- Remove plaintext password
- Persist UserAuthDto in `nv_auth.user_auth`
- Map profile DTO → UserDto
- S2S call User service create endpoint
- Roll back UserAuth on failure
- Always preserve the DtoBag invariant for pipeline/controller flow

This ADR defines the authoritative pipeline design for the Auth create operation.

---

## Decision

### 1. **Inbound Heterogeneous DtoBag Accepted**
Auth create supports a DtoBag containing:
- `UserCreateDto`
- `UserAuthDto`
No assumptions of ordering. Handlers must identify types via `dto.getType()`.

### 2. **Generate userId Early**
First handler creates a `userId = uuidv4()` and writes it into:
- `ctx["userId"]`
This value becomes:
- Primary key for `UserDto`
- Foreign key for `UserAuthDto`

### 3. **Password Strength + Encryption Handler**
A dedicated `PasswordStrengthAndEncryptHandler`:
- Extracts `UserAuthDto`
- Validates password strength (rejects weak)
- Generates salt
- Derives encrypted password
- Overwrites plaintext password in DTO (setter MUST wipe cleartext)
- Stamps `userId` onto UserAuthDto

### 4. **UserAuth Persistence (Singleton Rebag)**
`UserAuthDto` is rebagged as a **singleton DtoBag** and persisted:
- Wrapped into new bag via BagBuilder
- Written via DbWriter into collection:
  - `nv_auth`
  - `user_auth`
Handler must:
- Use standard `DbWriter.write()`
- Capture inserted id
- Store rollback details in `ctx["authPersist.rollback"]`

### 5. **AuthToUserDtoMapperHandler**
Using:
- `UserCreateDto` from original bag
- `userId` from ctx
It creates a new `UserDto`, maps overlapping fields, and rebags it as:
- `ctx["bag"] = DtoBag<UserDto>`

DTO mapping follows:
- Only fields that exist on both DTOs are copied
- No renaming, no shape drift
- Pure field-level copy (future DtoMapper util can be introduced)

### 6. **S2S Create User Handler**
`S2sClientCallHandler`:
- Reads `ctx["bag"]` (UserDto bag)
- Reads `ctx["op"] == "create"`
- Reads `ctx["dtoType"] == "user"`
- Calls `SvcClient.callBySlug("user", 1, "create", bag)`
- SvcClient wraps into wire envelope
- SvcClient adds S2S headers
- SvcClient resolves routing via svcconfig
- On success: rebag returned DtoBag<UserDto> into `ctx["bag"]`
- On failure:
  - Write error to ctx
  - Set `handlerStatus = "error"`
  - Controllers finalize into Problem+JSON

No envelope logic inside handler — SvcClient owns all HTTP ceremony.

### 7. **Rollback on Failure**
If user service create call fails:
- Retrieve rollback pointer from `ctx["authPersist.rollback"]`
- Delete inserted UserAuth record
- Re-raise error to pipeline (ctx error path)

Rollback handler uses:
- DbDeleter
- Deterministic filter `{ _id: rollbackId }`

### 8. **Pipeline Ends With DtoBag<UserDto>**
Controllers rely on:
- `ctx["bag"]` containing the final DtoBag<UserDto>
Controllers never inspect internal DTO fields — finalize() performs wire mapping.

---

## Consequences

### Positive
- Consistent bag-centric processing; heterogeneous → normalized → rebagged.
- Clean separation of responsibilities:
  - Auth handles credentials
  - User service handles profile
- SvcClient centralizes wire shape, envelopes, headers, routing.
- Rollback guarantees no orphaned UserAuth records.
- Strict DTO-only persistence matches NV’s architecture rails.
- Pipeline easy to test: each handler is pure and single-purpose.

### Negative
- Auth service now has its own CRUD-like storage (user_auth)
- More handlers per pipeline, but all follow lego-block design
- Slightly more ceremony, but aligns with NV’s long-term architecture

---

## Implementation Notes

Pipeline handler order:

```
1. GenerateUserIdHandler
2. PasswordStrengthAndEncryptHandler
3. UserAuthPersistHandler
4. AuthToUserDtoMapperHandler
5. S2sClientCallHandler
6. UserAuthRollbackOnFailureHandler (conditional)
```

Handler invariants:
- Never generate wire payloads
- Never directly serialize DTOs
- Always return DtoBags
- Never mutate DTO fields except through DTO’s own setters
- All errors mapped into ctx for finalize()

SvcClient invariants:
- Responsible for:
  - Bag envelope
  - S2S headers
  - svcconfig lookup
  - HTTP execution
  - Mapping response to DtoBag
- NOT responsible for DTO manipulation

DTO requirements:
- `UserAuthDto` must expose setters that wipe cleartext on encryption
- `UserDto` must validate that id is set early (before persistence)
- `UserDto` must accept all mapped profile fields from `UserCreateDto`

Rollback logic:
- Use deletion based on `_id`
- Must log rollback attempt and result
- Rollback failure should be fatal (500), instructing Ops to investigate orphaned credentials

---

## Alternatives Considered

### Alt 1 — Auth service writes to User DB directly  
Rejected. Violates service boundaries and creates cross-service contracts with no S2S interface.

### Alt 2 — Keep password handling in the User service  
Rejected. Secrets must be isolated to Auth service only; User service must never see plaintext or salts.

### Alt 3 — Use a combined mega-DTO  
Rejected. Violates DTO-first design and breaks separation between profile and credentials.

---

## References
- ADR-0040 DTO-Only Persistence
- ADR-0042 HandlerContext Bus
- ADR-0043 Finalize Mapping Rules
- ADR-0048 Write Semantics (DtoBag only)
- ADR-0050 Wire Bag Envelope
- ADR-0057 ID Validation & Generation
- ADR-0063 (this document)
