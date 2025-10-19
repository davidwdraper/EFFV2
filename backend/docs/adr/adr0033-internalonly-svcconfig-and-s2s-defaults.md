adr0033-internalonly-svcconfig-and-s2s-defaults.md

# ADR-0033 — Internal-Only Services & S2S Verification Defaults

## Context

Certain backend services such as `jwks` and `svcfacilitator` are **internal-only**: they must be callable by other workers via `SvcClient`, but **must never** appear in the public `gateway` mirror or be proxyable from outside the cluster.

Prior to this ADR, the `svcconfig` schema had no explicit way to mark such services as internal-only, and both the gateway and other services mirrored all entries indiscriminately. We also lacked standard configuration knobs to toggle S2S signing and verification defaults.

## Decision

### 1. `svcconfig.internalOnly`

A new boolean field `internalOnly` is introduced in the shared `svcconfig` contract:

```ts
internalOnly: boolean // default false
```

#### Behavior

- **Gateway mirror** — Filters out all entries where `internalOnly === true`.  
  These services can never be proxied publicly.
- **Worker mirrors** — Include internal-only services so that `SvcClient.call(...)` functions normally within the private network.

This ensures that the gateway mirror is safe for public exposure, while all worker mirrors remain feature-complete.

#### Health Check Exception (ADR‑0033‑A)

Internal-only services still need to expose **health endpoints** to external monitoring.  
To avoid reintroducing them into the public mirror, the **gateway implements a limited health-only fallback**:

1. When the gateway receives a `GET /api/<slug>/v<ver>/health` and no mirror entry exists,
2. It makes a direct call to the **facilitator’s resolve endpoint**  
   ```
   GET /api/svcfacilitator/v1/resolve?slug=<slug>&version=<ver>
   ```
3. The facilitator responds with the target service’s `baseUrl`.
4. The gateway extracts the port and **injects it** into the existing health proxy logic, reusing the normal proxy pipeline.
5. No caching or mirror update occurs; each health ping is resolved on demand.

This preserves `internalOnly` semantics while allowing reliable health visibility for every service, even those not mirrored.

### 2. S2S Defaults

#### `SvcClient`

By default, all internal service-to-service calls **sign JWTs** via the KMS-based `SvcSigner`.

Env knob:

```
NV_S2S_CLIENT_SIGN_DEFAULT=on|off|auto
```

- `on` — always sign requests (default)
- `off` — never sign requests
- `auto` — defer to per-call options

Per-call override:

```ts
SvcClient.call({ auth: "disabled" | "auto" | "required" })
```

- `disabled` — skip signing entirely
- `auto` — follow service default
- `required` — enforce signing; fail fast if unavailable

#### `SvcReceiver`

All inbound S2S requests are **validated by default** using the shared verification strategy (e.g., JWKS HTTP strategy).

Env knob:

```
NV_S2S_RECEIVER_VALIDATE_DEFAULT=on|off
```

- `on` — require validation (default)
- `off` — disable verification entirely for lightweight internal-only services like `jwks`

Per-route override is permitted but discouraged.

### 3. JWKS & SvcFacilitator Examples

- Both appear in `svcconfig` with `internalOnly: true`.
- Present in worker mirrors; absent from the gateway mirror.
- Gateway can still reach their `/health` endpoints through the health-only facilitator resolution fallback.
- Run without inbound token validation (`NV_S2S_RECEIVER_VALIDATE_DEFAULT=off` for JWKS).
- Use the same `SvcClient` and `SvcReceiver` plumbing as all other services.

### 4. Security Enforcement

- Attempting to proxy any non-health path for an internal-only service through the gateway returns **404 or 403**.
- Health proxy lookups are restricted to `GET` and paths ending in `/health`.
- Such requests are logged to the **SECURITY** category with `reason:"mirror_miss_internalOnly"`.
- Mirror mismatch detection warns if a service marked `internalOnly` ever appears in the gateway mirror.

## Consequences

- Clear separation between public and internal surfaces.
- Standardized S2S behavior for signing and verification with configurable defaults.
- Health checks for all services remain reachable without weakening the internal-only invariant.
- Gateway attack surface reduced to intended endpoints only.

## Implementation Notes

- Update shared contract to include `internalOnly`.
- Modify gateway mirror builder to exclude `internalOnly === true`.
- Modify worker mirror builders to include all services.
- Add fallback logic in the gateway’s health proxy:
  - If mirror lookup fails, query facilitator `/resolve`.
  - Inject resolved port into existing proxy target builder.
- Extend `SvcClient` and `SvcReceiver` to read new env knobs.
- Add smoke tests:
  - `018-mirror-excludes-internal.sh`
  - `019-gateway-proxy-deny-internal.sh`
  - `020-health-resolve-internalonly.sh` (gateway resolves port via facilitator)

## Alternatives Considered

- **Gateway-side exception list** — Rejected; brittle and duplicates DB state.
- **Separate mirror for health** — Rejected; adds maintenance overhead.
- **Reinserting internal services in limited form** — Rejected; breaks invariant and creates confusion.

## References

- SOP: `docs/architecture/backend/SOP.md` (Reduced, Clean)
- ADR-0020 — SvcConfig Mirror & Push
- ADR-0034 — JWKS KMS-Backed JWKS Endpoint
- ADR-0027 — SvcClient/SvcReceiver S2S Contract
- ADR-0029 — Contract-ID + BodyHandler pipeline
