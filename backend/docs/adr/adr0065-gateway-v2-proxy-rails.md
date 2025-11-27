adr0065-gateway-v2-proxy-rails

# ADR-0065 --- Gateway v2: SvcClient Proxy Rails, Svcconfig Cache Warm, and URL Path Preservation

## Context

Gateway v1 performed URL rewriting, local service resolution, and used
an in-memory "mirror" of svcconfig.\
This caused route drift, operational confusion, and divergence from the
platform's SvcClient-first architecture.

Gateway v2 must strictly follow the NV rails: - SvcClient is the only
routing mechanism. - svcconfig is the single source of truth. - Cache is
a lightweight optimization, not a mirror. - All paths beyond `<slug>`
must remain untouched. - Only headers---not paths---are rewritten.

This ADR adds an explicit constraint: **Gateway never changes the URL
path except removing `<slug>`**.

------------------------------------------------------------------------

## Decision

### 1. Gateway Preserves the Entire URL Path (Except `<slug>`)

Incoming:

    /api/<slug>/v<version>/<rest...>

Worker receives:

    /api/v<version>/<rest...>

Gateway must not: - Insert new path segments\
- Rename, collapse, reorder, or transform segments\
- Modify trailing slashes\
- Modify query params\
- Add version decorations

**The gateway performs exactly one path mutation: strip `<slug>` from
the path prefix.**

All remaining path content is forwarded verbatim.

------------------------------------------------------------------------

### 2. The Only Routing Change Is the Base URL (Host/Port/Protocol)

Gateway constructs the target URL using the resolved svcconfig entry:

    protocol://host:port

Then forwards the request to:

    protocol://host:port/api/v<version>/<rest...>

No other path transformation is permitted.

------------------------------------------------------------------------

### 3. Headers Are Rewritten, Not Paths

Gateway strips user-level headers and adds S2S headers:

Stripped: - `Authorization` - Any app-level bearer token\
- Any user identity headers

Added: - `authorization: Bearer <S2S token>` - `x-service-name` -
`x-api-version` - `x-request-id` (propagate)

This confirms: **Gateway modifies headers only. Path remains
unchanged.**

------------------------------------------------------------------------

### 4. In-Memory TTL Cache (Replaces Mirror)

Same as earlier ADR text: - Key: `(env, slug, version)` - Value:
`SvcconfigDto` - TTL-based entries - No background refresh loop\
- SvcClient handles lookup, validation, and caching\
- Admin route clears the cache

------------------------------------------------------------------------

### 5. Cache Warm at Boot (One-Shot)

At startup:

    GET /api/svcconfig/v1/list?env=<env>

Returns a `DtoBag<SvcconfigDto>`.

Gateway seeds the routing cache with each entry.\
If this call fails, **gateway refuses to boot**.

This is not a mirror; it is a one-shot warm.

------------------------------------------------------------------------

### 6. Runtime Request Flow (Final Model)

1.  Parse incoming URL:

    -   `slug`
    -   `version`
    -   `restPath`

2.  Construct internal worker route:

        /api/v<version>/<restPath>

3.  Resolve routing via SvcClient:

        protocol://host:port

4.  Forward to:

        protocol://host:port/api/v<version>/<restPath>

5.  Rewrite headers (not path).

6.  Relay worker response unchanged except for Problem+JSON
    normalization.

------------------------------------------------------------------------

## Consequences

### Benefits

-   Path determinism: what the client sends is what the worker receives.
-   Eliminates historical bugs caused by path rewrites.
-   Perfectly aligns with CRUD service contract (`/api/vX/...`).
-   Transparent debugging between gateway and workers.
-   Strong architectural invariants easy to test.

### Costs

-   Gateway cannot compensate for malformed client URLs.
-   Workers must match the canonical DTO-first route layout.

------------------------------------------------------------------------

## Implementation Notes

-   Route parser must extract `restPath` as a literal substring.

-   Proxy handler must concatenate:

        targetBaseUrl + "/api/v" + version + "/" + restPath

-   Query parameters must be preserved in full.

-   Path encoding must not be altered.

Unit tests must assert: - No segment transformation. - Slug removal
only. - Identical query params. - Identical slashes.

------------------------------------------------------------------------

## References

-   Original ADR-0065
-   LDD-14 / LDD-25 --- Gateway architecture\
-   LDD-12 --- SvcClient canonical routing\
-   LDD-16 / LDD-26 --- svcconfig architecture\
-   SOP --- Explicit, deterministic, DTO-first HTTP design
