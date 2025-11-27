adr0065-gateway-v2-proxy-rails

# ADR-0065 --- Gateway v2: SvcClient Proxy Rails & Svcconfig Cache Warm

## Context

Gateway v1 used an in-memory mirror of svcconfig, updated periodically,
to reduce S2S calls on each request.\
This design introduced complexity, race conditions, refresh bugs, and
dual sources of truth.\
With the new rails (envBootstrap, SvcClient, DTO-first, fail-fast), the
gateway must be simplified and aligned.

This ADR defines Gateway v2's routing model: - SvcClient is the only
routing mechanism. - Cache replaces the mirror. - Cache warms once at
boot. - Admin cache-clear route added. - Gateway boot requires svcconfig
availability.

## Decision

### 1. SvcClient as the Canonical Routing Mechanism

Gateway never constructs service URLs manually and never calls workers
via raw fetch.\
All routing must go through:

    svcClient.getRoute(env, slug, version)

The returned `SvcconfigDto` is the authoritative source of target
host/port/protocol.

### 2. In-Memory Cache (Not a Mirror)

A simple TTL-based in-memory cache is used by the SvcClient stack:

-   Key: `(env, slug, version)`
-   Value: `SvcconfigDto`
-   Behavior:
    -   Cache hit → return immediately.
    -   Cache miss or expired → fetch from svcconfig → validate → store
        → return.

This cache is purely an optimization. It is not a mirror and has no
background refresh loop.

### 3. Cache Warm at Boot

At startup, after envBootstrap succeeds:

1.  Gateway calls:

        GET /api/svcconfig/v1/list?env=<env>

2.  Receives a `DtoBag<SvcconfigDto>`.

3.  Iterates each DTO and seeds the route cache.

4.  Logs:

    -   Count of entries
    -   Disabled entries
    -   Slugs without the required version(s)

**If the list call fails, gateway startup fails.**

### 4. Admin Cache-Clear Route

Gateway exposes an admin-only route:

    POST /api/gateway/v1/admin/cache/clear

Handler:

    svcClient.clearRouteCache()

Returns:

``` json
{
  "ok": true,
  "detail": "Routing cache cleared. Next requests will fetch from svcconfig."
}
```

This allows Ops to force routing updates after svcconfig changes.

### 5. Routing Flow at Runtime

For every inbound request:

1.  Extract `{ slug, version, restPath }` from the public URL.

2.  Call:

        const dto = await svcClient.getRoute(env, slug, version)

    -   Cache hit → ok
    -   Cache miss → fetch from svcconfig
    -   Fetch error → return `503 SVCCONFIG_UNAVAILABLE` (Problem+JSON)

3.  SvcClient performs the internal call to the worker.

Gateway never mints S2S tokens directly; SvcClient handles this.

### 6. Failure Semantics

-   **Boot:** must reach svcconfig to warm the cache.
-   **Runtime:** cached entries remain usable until TTL expiry.
-   **On cache miss:** failure to reach svcconfig results in 503.
-   No silent fallback, no best-effort routing.

## Consequences

### Benefits

-   Aligned with LDD-12, LDD-14, LDD-16.
-   Eliminates complex mirror logic.
-   Ensures single source of truth.
-   Much easier to reason about.
-   Lightweight runtime performance boost via caching.
-   Ops has explicit cache eviction control.

### Costs

-   Cached routes may become stale until manually refreshed or TTL
    expires.
-   svcconfig outages during runtime impact uncached or expired entries.

## Implementation Notes

-   Cache and TTL managed in the shared SvcconfigClient/SvcClient layer.

-   TTL configured from env-service.

-   Gateway boot sequence:

    -   envBootstrap
    -   warm svcconfig list
    -   AppBase boot continues

-   Boot logs must show the svcconfig warm summary.

-   Future admin route:

        POST /api/gateway/v1/admin/cache/warm

    to manually re-seed from list.

## Alternatives Considered

### Full mirror (old design)

Rejected: too complex; caused stale state, drift, and refresh bugs.

### No caching at all

Rejected: would hammer svcconfig under high load.

### Background refresh loop

Rejected: unnecessary complexity; creates race conditions.

## References

-   LDD-12 --- SvcClient & S2S contract\
-   LDD-14 / LDD-25 --- Gateway architecture\
-   LDD-16 / LDD-26 --- svcconfig architecture\
-   SOP --- fail-fast, DTO-first, no mirror semantics
