# API Route Conventions

_Last updated: 2025-09-08_

## CURRENT (as of this commit)

- External path: `/api/<slug>/<resource...>`
  - Example: `/api/act/acts/:id`
  - Health endpoints are outside `/api` (e.g., `/healthz`)
- Gateway strips `<slug>` and proxies the remainder to the service base URL from svcconfig.
- Services use **singular** slug; **plural** resource collections.

## PLANNED (accepted; NOT YET SHIPPED)

- Versioned slug: `/api/<slug>.V1/<resource...>`
  - Example: `/api/act.V1/acts/:id`
  - Rationale: explicit API surface versioning at the edge without path churn inside services.
  - Migration: gateway will support both `/api/<slug>/...` and `/api/<slug>.V1/...` during a transition window (TBD), then deprecate the former.

## Invariants

- No logic in routes; handlers only.
- Create = PUT collection root; Update = PATCH /:id; Replace via PUT /:id is unsupported.
- S2S required on all non-health worker routes; HTTPS only in staging/prod (HSTS).

## Links

- ADR: `/docs/adr/0002-route-versioning-at-slug.md` (status: Proposed/Accepted)
- Design impact: gateway routing map, svcconfig lookup, audit `path` normalization.
