# adr0061-s2s-route

## Context

Active service: **svcconfig**.\
A dedicated S2S resolution API is required so that all S2S calls can
reliably determine the target worker service by `(env, slug, version)`
without relying on local env variables or hard‑coded URLs.

## Problem

SvcClient currently performs internal resolution using svcconfig
mirrors, but no canonical **HTTP-level** API exists for workers/gateway
to fetch a single authoritative routing record.\
This creates risk of: - Drift between local mirrors and DB state\
- Incorrect fallback logic\
- Ambiguous or disabled svcconfig records going unnoticed

## Decision

Create new GET operation:

    GET /api/svcconfig/v1/svcconfig/s2s-route/:slug/:version

This is implemented as a **new op** (`s2s-route`) inside the existing
`svcconfig.read.controller`, not a new controller.

A **new read pipeline** (`svcconfig.s2s-route.pipeline`) executes:

1.  Validate slug + version\
2.  Build strict filter using:
    -   env (from svcEnv)
    -   slug (path)
    -   version (path)
    -   role='worker'
    -   enabled=true\
3.  Query svcconfig collection\
4.  Enforce **exactly one** match
    -   0 → 404 `SVC_ROUTE_NOT_FOUND`\

    -   1 → 409 `SVC_ROUTE_AMBIGUOUS`
5.  Return a **singleton DtoBag`<SvcconfigDto>`{=html}**

## Consequences

-   SvcClient now has a stable S2S discovery endpoint
-   All S2S calls can depend on a single declarative route
-   Ops gets clearer error signals (404 vs 409)
-   Controller remains small; list/mirror controller unaffected

## Implementation Notes

-   Route wiring is one-liner in `svcconfig.read.route.ts`
-   Controller switch adds:
    `case 's2s-route': return runS2sRoutePipeline()`
-   Pipeline lives alongside other read pipelines
-   All errors surface via Problem+JSON with Ops guidance

## Alternatives

-   Add logic to list/mirror: rejected (multi-row semantics)
-   Add new controller: rejected (simple GET read op)

## References

-   LDD-06, LDD-12, LDD-16, LDD-19, LDD-26, LDD-34
