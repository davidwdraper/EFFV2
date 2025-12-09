adr0071-auth-signup-jwt-placement
# ADR-0071 — Auth Signup JWT Placement

## Context

The Auth signup flow is now wired end-to-end via the Gateway:

- Client → Gateway (`/api/auth/v1/user/signup`)
- Gateway → Auth (S2S)
- Auth orchestrates:
  - Creation of the `user` record (in the User service),
  - Creation of the `user-auth` record (in the Auth service),
  - Minting of a JWT for the signed-up user.

The existing rails already ensure that:

- DTOs are canonical (DTO-first; no models/schemas/mappers outside DTOs).
- All HTTP responses are normalized through a **bag-centric finalizer** in `ControllerJsonBase`.
- The wire envelope is `{ ok, items, meta }` as defined by ADR-0050.
- `ctx["bag"]` is treated as **sacred, one-writer-only** (the hydrator), with DTOs living only inside the bag.

What was missing in the original implementation:

- The JWT was successfully minted during signup,
- But it was **never surfaced in the final wire envelope**,
- Because no canonical place existed for the token in `HandlerContext` or the response `meta`,
- And `code.mintUserAuthToken.ts` drifted beyond the minimal behavior required: “mint token, stash token, let finalizer surface it”.

We need a **single, explicit rule** for:

1. Where the JWT lives in `HandlerContext`,
2. How the finalizer reads it,
3. Where it appears in the response envelope,
4. Without violating DTO/BAG invariants or leaking token handling into DTOs.

## Decision

1. **JWTs live in the HandlerContext, not in DTOs or DtoBag meta.**

   - Tokens are **ephemeral auth artifacts**, not domain data.
   - They must never be persisted, and must not appear in DTOs or their JSON.
   - `ctx["bag"]` remains “data-only”; no JWT fields are introduced into the bag or its meta.

2. **Canonical context key for a user auth JWT:**

   - The JWT minted during signup is stored under:

     ```ts
     ctx.set("jwt.userAuth", tokenString);
     ```

   - This key is reserved for Auth flows that mint user auth tokens.
   - Additional token types (e.g., refresh tokens, S2S tokens) must use their own explicit keys
     (e.g., `jwt.userAuthRefresh`, `jwt.s2s.gateway`, etc.), to avoid type ambiguity.

3. **Canonical placement in the wire envelope:**

   - The finalizer in `ControllerJsonBase` MUST surface user auth JWTs in the `meta.tokens` object:

     ```jsonc
     {
       "ok": true,
       "items": [ /* bag items */ ],
       "meta": {
         "count": 1,
         "dtoType": "user",
         "op": "signup",
         "tokens": {
           "userAuth": "<JWT string>"
         }
       }
     }
     ```

   - `meta.tokens` is a **reserved map of token names → token strings**.
   - `meta.tokens.userAuth` is the canonical field for the primary user auth JWT returned from signup.

4. **Finalizer behavior (ControllerJsonBase):**

   - `ControllerJsonBase.finalize()`:
     - Reads `ctx["bag"]` and converts it to JSON for `items` and core `meta` fields.
     - Reads `ctx["jwt.userAuth"]` (if present).
     - If present, ensures the outbound `meta` contains:

       ```ts
       meta.tokens = {
         ...(meta.tokens ?? {}),
         userAuth: ctx.get<string>("jwt.userAuth"),
       };
       ```

   - If no JWT was minted or present, `meta.tokens` is omitted entirely, or left as-is if populated by other logic.

5. **Handler responsibilities (code.mintUserAuthToken.ts):**

   - `code.mintUserAuthToken.ts` is a **single-purpose handler** that:
     - Reads the necessary DTO(s) from `ctx["bag"]` (typically `user-auth`),
     - Uses strict env access via `getVar(..., { required: true })` to obtain KMS/JWT settings,
     - Calls the token-minter component,
     - On success, writes the token to `ctx["jwt.userAuth"]`,
     - Does **not** mutate `ctx["bag"]`, `ctx["response"]`, or any wire shape.
   - Error handling remains in the standard HandlerBase pattern (set handlerStatus, attach Problem+JSON fields to ctx).

6. **No DTO or persistence coupling to JWTs:**

   - No DTO gains fields for JWT or token-related data.
   - No DbWriter/DbReader, repository, or persistence layer is aware of tokens.
   - JWTs are strictly runtime-only values, surfaced in the HTTP response via `meta.tokens`.

## Consequences

**Positive**

- **Clean separation of concerns**:
  - DTOs remain pure domain representations.
  - JWTs are treated as ephemeral auth artifacts, never persisted or baked into DTOs.
- **Predictable wire contract**:
  - Clients always know where to look for the JWT: `response.meta.tokens.userAuth`.
- **No drift in DtoBag invariants**:
  - `ctx["bag"]` stays sacred and data-only; token handlers cannot corrupt bag state.
- **Future-proof**:
  - Adding additional tokens (e.g., refresh tokens) just extends `meta.tokens` without touching DTOs or existing consumers,
    as long as key names are well-documented.

**Negative / Trade-offs**

- Slightly more logic in the finalizer to merge `meta.tokens` cleanly.
- Token-related behavior is now a hard contract; future changes (e.g., token structure or multiple tokens) must respect or version this behavior.

## Implementation Notes

- **HandlerContext Keys**

  - The following keys are reserved for auth tokens:

    ```ts
    // Primary user auth token minted during signup/login:
    "jwt.userAuth"
    ```

  - Future keys (examples, not yet implemented):

    ```ts
    "jwt.userAuthRefresh"
    "jwt.userAuthShortLived"
    "jwt.s2s.gateway"
    ```

  - All token keys follow `jwt.<scope>` or `jwt.<scope>.<variant>` for clarity.

- **ControllerJsonBase.finalize()**

  - Must:
    - Keep existing behavior for `ok`, `items`, `meta` intact.
    - Read `ctx["jwt.userAuth"]` once, and if present, write it into `meta.tokens.userAuth`.
    - Never overwrite other `meta.tokens` fields if they already exist.

- **code.mintUserAuthToken.ts**

  - On success:
    - Must call `ctx.set("jwt.userAuth", tokenString)`.
  - On failure:
    - Must follow standard error reporting:
      - Set `handlerStatus = "error"`,
      - Set `response.status` and Problem+JSON body fields on ctx,
      - Include operator guidance in `detail` for triage (per LDD-29).

- **Testing**

  - Add/extend tests to assert that a successful signup via gateway returns:

    ```jsonc
    {
      "ok": true,
      "items": [ { "type": "user", ... } ],
      "meta": {
        "dtoType": "user",
        "op": "signup",
        "tokens": {
          "userAuth": "<JWT>"
        }
      }
    }
    ```

  - Ensure tests also cover failure cases where token minting fails, verifying that:
    - No `meta.tokens.userAuth` is present on error,
    - Problem+JSON error details include operator guidance.

## Alternatives

1. **Embedding JWT into DtoBag meta**

   - Rejected:
     - DtoBag meta is intended for DTO-related metadata (e.g., count, dtoType, op), not ephemeral security tokens.
     - Would blur the line between domain data and security artifacts and tempt persistence of meta.

2. **Returning JWT as a top-level field (`{ ok, items, meta, jwt }`)**

   - Rejected:
     - Breaks the established ADR-0050 envelope shape,
     - Makes it harder to generalize multiple token types without multiplying top-level fields.

3. **Storing JWT in the user DTO itself**

   - Rejected (strongly):
     - Violates security expectations (we never persist or model tokens as part of domain entities).
     - Encourages accidental persistence or logging of tokens.

## References

- ADR-0040 — DTO-Only Persistence via Managers  
- ADR-0042 — HandlerContext Bus — KISS  
- ADR-0049 — DTO Registry & Wire Discrimination  
- ADR-0050 — Wire Bag Envelope; Singleton Inbound  
- ADR-0053 — Bag Purity; No Naked DTOs on the Bus  
- ADR-0057 — JWT ID Generation & SvcClient S2S (future-aligned)  
- LDD-17 — Error Architecture & Problem+JSON  
- LDD-21 — Auth Architecture (High-Level)
