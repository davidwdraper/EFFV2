adr0085-gateway-proxy-client-fast-path

# Context

Gateway is a pure edge proxy: it must not require a DTO registry, must not hydrate DTOs, and must forward requests with the same path (only host/port differs). The existing SvcClient.callRaw() includes service-rails behavior (resolver + header composition + validations) and its parameter contract is easy to misuse from gateway code, causing routing failures (e.g., slug/version undefined).

# Decision

Create a gateway-scoped `GatewayProxyClient` that:

- Owns the minimal proxy contract: parse inbound target slug/version + fullPath, resolve baseUrl via svcconfig TTL cache, forward request, return raw response.
- Accepts a strict input shape (env, slug, version, method, fullPath, requestId, headers, body).
- Filters hop-by-hop headers and forbids overriding canonical S2S headers (x-request-id, x-service-name, x-api-version).
- Never depends on DTO registry or Handler pipelines.
- Lives only under `backend/services/gateway/src/...`.

SvcClient.callRaw() remains available but is not used directly by Gateway routes.

# Consequences

- Gateway becomes faster and more predictable by avoiding accidental coupling to service rails.
- Non-DB services cloned from templates are unaffected; only gateway uses this specialized proxy client.
- We add a small amount of gateway-only code, but it is single-purpose and testable.

# Implementation Notes

- Strip hop-by-hop headers (connection, keep-alive, transfer-encoding, upgrade, etc.).
- Preserve secret-bearing headers without logging values (e.g., x-nv-password, authorization).
- Forward response status + bodyText and pass through safe response headers (at minimum content-type).
- TTL resolver remains the source of truth for baseUrl resolution.

# Alternatives

- Continue using SvcClient.callRaw() directly from gateway controller and enforce correct param key usage.
  Rejected because it’s easy to misuse and drags in rails assumptions that don’t belong on the edge.

# References

- ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
- ADR-0084 (Service Posture & Boot-Time Rails)
