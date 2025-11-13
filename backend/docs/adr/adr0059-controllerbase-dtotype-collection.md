# adr0059-controllerbase-dtotype-collection

## Context

ControllerBase now centrally resolves `dtoType` and the corresponding
`dbCollectionName` for all controllers that operate on DTO‑typed routes.
Historically, each controller needed to independently extract `dtoType`
from the route parameters and resolve its database collection via the
service's DtoRegistry. This duplicated logic and increased the risk of
drift.

## Decision

ControllerBase now performs the following responsibilities: 1. Extracts
`dtoType` from the inbound request path (e.g.,
`/api/xxx/v1/<dtoType>/op/...`). 2. Validates that a `dtoType` exists
and places it into the HandlerContext as `ctx["dtoType"]`. 3. Uses the
service's DtoRegistry to resolve the correct MongoDB collection name for
that DTO type. 4. Places that result into the HandlerContext as
`ctx["db.collectionName"]`.

This design: - Standardizes how dtoType and db collection names are
discovered. - Eliminates repeated boilerplate in all controllers. -
Ensures every HandlerBase instance has access to these values
consistently via the shared context.

## Consequences

Positive: - No more per‑controller logic for dtoType or collection
lookups. - Handlers can trust that both values are always available. -
Future services automatically inherit consistent behavior.

Negative: - Controllers must invoke the new context builder
(`makeDtoOpContext`) for typed-routing operations. - Improper registry
configuration will fail earlier and more explicitly.

## Implementation Notes

-   ControllerBase adds
    `makeDtoOpContext(req, res, op, { resolveCollectionName: true })`.
-   This helper performs extraction, validation, registry lookup,
    stamping into `ctx`, and logging.
-   Handlers read `dtoType` and `db.collectionName` exclusively from the
    context.

## Alternatives Considered

1.  **Per-controller resolution**\
    Rejected --- too error‑prone, leads to duplication, and risks drift.
2.  **Store dtoType and collectionName on the Controller instance**\
    Rejected --- controllers are singletons and may process concurrent
    requests.

## References

-   ADR‑0040 through ADR‑0050 (DTO‑first + bag‑only architecture)
-   Updates to ControllerBase.ts introducing `makeDtoOpContext`
