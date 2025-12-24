Context

Gateway is a pure proxy service:

It does not read/write a database.

It does not hydrate DTOs.

It does not need a DTO registry for routing, persistence, or index boot.

Today, AppBase hard-requires a DTO registry via:

public abstract getDtoRegistry(): IDtoRegistry;

onBoot() calling performDbBoot({ ..., registry: this.getDtoRegistry() }) unconditionally (even when checkDb=false).

This forces proxy services to ship “ceremonial registry” code (or fake registries) purely to satisfy the base class contract, which violates the platform’s single-concern rule and creates drift risk (template leftovers, confusing boot behavior, misleading assumptions).

Separately, the current gateway proxy controller contains security and contract violations:

It logs raw inbound headers and a password header (high-risk leakage).

It uses app as any to reach svcClient, despite AppBase.getSvcClient() already existing.

It falls back to "unknown" env labels instead of using SvcSandbox-authoritative getEnvLabel().

This ADR focuses on the AppBase contract change needed to remove the gateway registry completely.

Decision

Make the DTO registry optional in AppBase for services that do not use DTO routing and do not perform DB boot.

AppBase will no longer require every service to implement getDtoRegistry().

Gate DB boot strictly on checkDb === true.

If checkDb is false, AppBase.onBoot() must skip DB boot entirely and must not require a registry.

If checkDb is true, a registry becomes required and missing/undefined registry is a fail-fast boot error.

Preserve existing behavior for DB-backed services.

All DTO/DB services continue to provide a concrete registry and continue to run DB boot + index ensure exactly as today.

This is not a behavior change for DB-backed services; it is removal of proxy-service ceremony.

Consequences
Positive

Proxy services (gateway, future edge services) can be truly minimal:

no registry folder

no “empty registry” shims

no accidental template drift

Boot semantics become clearer and safer:

DB boot code cannot run unless explicitly enabled (checkDb=true).

Better enforcement of architectural roles:

DTO registry = DTO routing + persistence concern

Proxy = transport concern only

Negative / Costs

This is a breaking change for any service subclassing AppBase that assumes getDtoRegistry() always exists.

Mitigation: DB-backed services remain unchanged; proxy services stop overriding.

Some shared boot helpers may assume registry is always present.

Mitigation: limit registry usage inside DB boot path only.

Implementation Notes

Planned updates (after approval):

backend/services/shared/src/base/app/AppBase.ts

Replace public abstract getDtoRegistry(): IDtoRegistry; with a default optional form, e.g.:

public getDtoRegistry(): IDtoRegistry | null { return null; }

Update onBoot() to:

if this.checkDb === false: return immediately (skip DB boot)

else:

require const registry = this.getDtoRegistry()

if !registry: throw a boot error like DTO_REGISTRY_MISSING_ON_DB_SERVICE

backend/services/shared/src/base/app/appBoot.ts

Ensure performDbBoot() requires a registry (or is only called when registry is present).

Any index ensure logic remains unchanged, but only runs when checkDb is true.

Gateway follow-up changes (separate from this ADR but enabled by it)

Delete backend/services/gateway/src/registry/\*\*

Remove registry construction and override from gateway/src/app.ts

Fix entrypoint drift: checkDb must be false at the entrypoint as well

Remove any access to svcClient and use app.getSvcClient()

Remove header logging / redact/whitelist only

Remove "unknown" env fallback and use getEnvLabel() (SSB authoritative)

Alternatives

Keep abstract registry and add an EmptyRegistry

Rejected: it’s still ceremony, still drift-prone, and it keeps proxy services pretending to be DTO services.

Create a separate ProxyAppBase

Rejected (for now): adds another base class and increases mental overhead. Optional registry is a smaller, cleaner change.

Leave as-is and tolerate template baggage

Rejected: increases risk and violates single-concern. Also creates security risks when “template debug logs” linger (as seen).

References

SOP: docs/architecture/backend/SOP.md (Reduced, Clean)

ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)

ADR-0049 (DTO Registry & Wire Discrimination)

ADR-0045 (Index Hints — boot ensure via shared helper)

ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
