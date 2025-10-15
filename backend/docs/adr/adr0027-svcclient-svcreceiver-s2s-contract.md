# adr0027-svcclient-svcreceiver-s2s-contract (Baseline, pre-auth)

> **Scope of this ADR**: Locks the *current* S2S plumbing to match the existing code you posted
> (`SvcClient`, `SvcClientBase`, `SvcReceiver`, `types.ts`). **JWT, caller/authz,
> and request-envelope enforcement are explicitly deferred to a follow‑up ADR.**
> This prevents drift *today* while allowing a clean upgrade path in the next step.

---

## Context
We’ve had recurring drift around how services call each other (S2S), how URLs are formed from `slug@version`, and what envelopes/headers are expected. The live code shows:

- `SvcClient` extends `SvcClientBase` and performs **fail‑fast HTTP** with standard headers and request‑ID propagation.
- `SvcReceiver` normalizes **responses** into `{ ok: true|false, data|error }` and always sets `x-request-id` on egress.
- A shared `UrlResolver` is injected into `SvcClient` to map `(slug, version) → baseUrl`, and callers pass a **service‑local path** via `opts.path`.
- **No JWT, no caller authz, and no request envelope wrapping** in `SvcClient` yet (to be added next).

We need one source of truth for **today’s** behavior so Gateway, Auth, User, and Audit stay in lock‑step while we layer in auth/envelopes next.

---

## Decision
Adopt the following invariants that exactly match the posted code.

### 1) Outbound calls use `SvcClient.call(opts)` (only)
**Canonical signature** (from `types.ts` / `SvcClientBase.call`):
```ts
call<T = unknown>(opts: SvcCallOptions): Promise<SvcResponse<T>>

// where SvcCallOptions is:
interface SvcCallOptions {
  slug: string;
  version?: number;                   // default: 1
  path: string;                       // service-local path, e.g. "/entries"
  method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; // default: "GET"
  headers?: Record<string, string|undefined>;
  query?: Record<string, string|number|boolean|undefined>;
  body?: unknown;                     // JSON-serializable
  timeoutMs?: number;                 // default: 5000
  requestId?: string;                 // optional; auto-generated if missing
}
```

**Behavior** (from `SvcClientBase.call`):
- Resolves `base` via injected `UrlResolver(slug, version)`.
- Builds final URL: `buildUrl(base, opts.path, opts.query)`.
- Sets headers:
  - `x-request-id` (propagated or auto‑generated),
  - `accept: application/json`,
  - optional defaults and per‑call headers,
  - `content-type: application/json` when there is a body and caller didn’t set one.
- Sends body as raw string/bytes **or** JSON‑stringifies non‑string payloads for non‑GET/DELETE/HEAD.
- **Fail‑fast**: throws on any network/timeout error or non‑2xx HTTP status (after logging a structured warning).

**Return** (`SvcResponse<T>`):
- 2xx → `{ ok: true, status, headers, data, requestId }`
- Non‑2xx → **throws** (caller should catch and map to problem details as needed).

### 2) URL resolution (no literals; single place)
`UrlResolver: (slug: string, version?: number) => string|Promise<string>`

**Contract (baseline)**:
- Must return the **service base URL** used by `buildUrl()`.
- **Recommended invariant** (to avoid double‑versioning):
  - Resolver returns: `"<serviceExternalBase>/api/<slug>/v<version>"`.
  - Callers pass **service‑local** `opts.path` (e.g. `"/entries"`), not `"/api/.../v.../entries"`.
- **No hardcoded hosts or ports**. Resolver must rely on `svcconfig` (itself hydrated from `svcFacilitator`) or env‑driven config, per Environment Invariance.

### 3) Inbound handling uses `SvcReceiver.receive(req, res, handler)`
**Behavior** (from `SvcReceiver`):
- Picks/propagates `requestId` from headers or generates a UUID.
- Logs an edge “ingress” event.
- Calls the provided `handler(ctx)` and expects `{ status?, body?, headers? }`.
- Always sets `x-request-id` on response.
- Returns a **normalized envelope**:
  - Success (`status < 400`): `{ ok: true, service, requestId, data }`
  - Error   (`status >= 400`): `{ ok: false, service, requestId, error }`
- Catches exceptions and emits `{ ok: false, error: { code: "internal_error", message } }` with `500`.

**Out of scope in this ADR (deferred to next)**:
- JWT verification / allowed callers
- Required S2S header checks beyond `x-request-id`
- Request‑side envelope validation/unwrap

### 4) Gateway usage (proxy + audit) — consistent with the above
- Gateway publishes **one** `SvcClient` instance (constructed with a single `UrlResolver`) to `app.locals.svcClient` **before** audit and proxy.
- Proxy uses a shared `UrlHelper` to parse `{ slug, version, route }` and calls:
  ```ts
  svcClient.call({
    slug, version,
    path: route,            // service-local (e.g., "/users" or "/health/live")
    method, headers, body, query, requestId
  });
  ```
- **Health routes** are proxied but **not audited** (audit middleware auto‑skips health).
- Audit WAL flusher uses the same client:
  ```ts
  svcClient.call({ slug: "audit", version: 1, path: "/entries", method: "POST", body: batch });
  ```

### 5) Environment invariance (unchanged, enforced)
- No network/filesystem literals in code paths. All inputs come from env or `svcconfig`.
- Resolver failures (e.g., missing `baseUrl` for `slug@version`) should surface as explicit errors (no silent fallback).

---

## Consequences
- **Stops drift now** by aligning docs with the actual code paths you shared.
- Gives Gateway, Auth, User, and Audit a single, dependable calling/receiving contract.
- Leaves room to **incrementally** add JWT + request‑envelope semantics without breaking call sites (`SvcClient.call(opts)` remains the entrypoint).

---

## Implementation Notes (today)
- Keep `SvcClient` thin; extend/compose later if needed.
- Maintain a single `UrlResolver` backed by the warmed `svcconfig` mirror.
- Ensure all callers pass **service‑local** `path` consistently.
- Unit‑test `buildUrl()` and a couple of representative `call()` variations (with/without body, timeouts).

---

## Next ADR (immediately after this)
- Add **S2S JWT** + **allowed-callers** checks into `SvcReceiver`.
- Define **request envelope** shape and make `SvcClient` handle wrapping.
- Require/propagate **x-service-name** and **x-api-version** and validate them inbound.
- Extend acceptance tests to cover audience/issuer mismatches and envelope errors.

---

## References
- `backend/services/shared/src/svc/SvcClient.ts`
- `backend/services/shared/src/svc/SvcClientBase.ts`
- `backend/services/shared/src/svc/types.ts`
- `backend/shared/src/svc/SvcReceiver.ts`
- SOP: `docs/architecture/backend/SOP.md` (Reduced, Clean)
